// Учебный REST-сервер без зависимостей (нужен Node.js 18 или новее).
// Данные хранятся в памяти: после перезапуска возвращаются значения из db.json.
// Запуск: node server.js
//
// Код взят из приложения A методички. Добавлено: проверка коллекции courses
// (validateCourse) — обязательные поля, допустимые значения и уникальный код курса,
// чтобы клиент мог показать ошибки сервера 422 и 409 для своей предметной области.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;
// Разрешённые источники (origin) через запятую. Браузер с другого origin получит ошибку CORS.
const ALLOWED = (process.env.ALLOWED_ORIGIN || "http://localhost:5173").split(",");
const DELAY_MS = Number(process.env.DELAY_MS) || 0; // искусственная задержка для демонстрации загрузки
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "db.json");

const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

function send(req, res, status, body) {
  const origin = req.headers.origin;
  if (origin && ALLOWED.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (status === 204) {
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        reject(new Error("Некорректный JSON"));
      }
    });
  });
}

const isObject = (x) => typeof x === "object" && x !== null && !Array.isArray(x);

function validateStudent(body, list, selfId) {
  for (const f of ["firstName", "lastName", "email", "group"]) {
    if (typeof body[f] !== "string" || body[f].trim() === "") {
      return { status: 422, message: `Поле ${f} обязательно` };
    }
  }
  if (!/^\S+@\S+\.\S+$/.test(body.email)) {
    return { status: 422, message: "Некорректный email" };
  }
  if (list.some((s) => s.email === body.email && s.id !== selfId)) {
    return { status: 409, message: "Студент с таким email уже существует" };
  }
  return null;
}

// --- Добавлено для коллекции courses ---
const COURSE_CATEGORIES = ["CS", "MATH", "LANGUAGES", "GENERAL"];

function validateCourse(body, list, selfId) {
  for (const f of ["code", "title"]) {
    if (typeof body[f] !== "string" || body[f].trim() === "") {
      return { status: 422, message: `Поле ${f} обязательно` };
    }
  }
  if (!Number.isInteger(body.credits) || body.credits < 1 || body.credits > 15) {
    return { status: 422, message: "Поле credits — целое число от 1 до 15" };
  }
  if (!COURSE_CATEGORIES.includes(body.category)) {
    return { status: 422, message: `Поле category — одно из: ${COURSE_CATEGORIES.join(", ")}` };
  }
  if (!Number.isInteger(body.teacherId) || body.teacherId <= 0) {
    return { status: 422, message: "Поле teacherId — целое положительное число" };
  }
  if (typeof body.feeKgs !== "number" || body.feeKgs < 0) {
    return { status: 422, message: "Поле feeKgs — число не меньше 0" };
  }
  if (typeof body.isPublished !== "boolean") {
    return { status: 422, message: "Поле isPublished — true или false" };
  }
  const code = body.code.trim().toUpperCase();
  if (list.some((c) => c.code.toUpperCase() === code && c.id !== selfId)) {
    return { status: 409, message: `Курс с кодом ${code} уже существует` };
  }
  return null;
}

const VALIDATORS = { students: validateStudent, courses: validateCourse };
// --- конец добавления ---

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "students", "3"]

  if (req.method === "OPTIONS") {
    const origin = req.headers.origin;
    if (origin && ALLOWED.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    res.writeHead(204);
    return res.end();
  }

  if (parts[0] !== "api" || !parts[1] || !(parts[1] in db)) {
    return send(req, res, 404, { message: "Ресурс не найден" });
  }

  const resource = parts[1];
  const list = db[resource];
  const id = parts[2] === undefined ? undefined : Number(parts[2]);
  const validate = VALIDATORS[resource];

  if (id === undefined) {
    if (req.method === "GET") {
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 10));
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const filtered = q
        ? list.filter((r) => Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes(q)))
        : list;
      const start = (page - 1) * limit;
      return send(req, res, 200, { items: filtered.slice(start, start + limit), total: filtered.length, page, limit });
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      if (!isObject(body)) return send(req, res, 400, { message: "Тело запроса должно быть объектом JSON" });
      const bad = validate ? validate(body, list) : null;
      if (bad) return send(req, res, bad.status, { message: bad.message });
      const created = { ...body, id: list.reduce((m, r) => Math.max(m, r.id), 0) + 1, createdAt: new Date().toISOString() };
      list.push(created);
      return send(req, res, 201, created);
    }
    return send(req, res, 405, { message: "Метод не поддерживается" });
  }

  if (!Number.isInteger(id)) return send(req, res, 400, { message: "Некорректный идентификатор" });
  const index = list.findIndex((r) => r.id === id);
  if (index === -1) return send(req, res, 404, { message: "Запись не найдена" });

  if (req.method === "GET") return send(req, res, 200, list[index]);
  if (req.method === "DELETE") {
    list.splice(index, 1);
    return send(req, res, 204);
  }
  if (req.method === "PUT" || req.method === "PATCH") {
    const body = await readBody(req);
    if (!isObject(body)) return send(req, res, 400, { message: "Тело запроса должно быть объектом JSON" });
    const old = list[index];
    const next = req.method === "PUT"
      ? { ...body, id: old.id, createdAt: old.createdAt }
      : { ...old, ...body, id: old.id, createdAt: old.createdAt };
    const bad = validate ? validate(next, list, old.id) : null;
    if (bad) return send(req, res, bad.status, { message: bad.message });
    list[index] = next;
    return send(req, res, 200, next);
  }
  return send(req, res, 405, { message: "Метод не поддерживается" });
}

http
  .createServer((req, res) => {
    const run = () =>
      handle(req, res).catch((err) => send(req, res, err.message === "Некорректный JSON" ? 400 : 500, { message: err.message }));
    DELAY_MS ? setTimeout(run, DELAY_MS) : run();
  })
  .listen(PORT, () => console.log(`Mock-сервер: http://localhost:${PORT}/api/students (разрешён origin: ${ALLOWED.join(", ")})`));
