const TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const CODE_MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

// مدلی که فقط وقتی TEXT_MODEL از Vision پشتیبانی نکند برای پردازش تصاویر ارسالی کاربر استفاده می‌شود.
// این مدل واقعاً در کاتالوگ Cloudflare Workers AI موجود و از نوع Vision است.
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

const MAX_REQUESTS_PER_HOUR = 10;

// ==================================================
// محدودیت‌های آپلود فایل/عکس (نکته امنیت: بررسی حجم و نوع در Backend)
// ==================================================
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;   // 6MB
const MAX_FILE_BYTES = 8 * 1024 * 1024;    // 8MB
const MAX_EXTRACTED_CHARS = 12000;         // برای جلوگیری از پر شدن Context مدل

const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};
const IMAGE_EXT_FALLBACK = { jpg: 1, jpeg: 1, png: 1, webp: 1 };

// نوع فایل بر اساس MIME (اگر مرورگر MIME درستی نفرستد، از پسوند فایل استفاده می‌شود)
const ALLOWED_FILE_MIME = {
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/csv": "csv",
  "application/vnd.ms-excel": "csv",
  "application/json": "json",
  "text/json": "json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx"
};
const ALLOWED_FILE_EXT = { pdf: 1, txt: 1, csv: 1, json: 1, docx: 1, xlsx: 1 };

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    try {
      const url = new URL(request.url);

      // ==================================================
      // TEST AI BINDING
      // ==================================================
      if (url.pathname === "/test-ai" && request.method === "GET") {
        return response({
          ok: true,
          ai_exists: !!env.AI,
          ai_type: typeof env.AI,
          sessions_exists: !!env.SESSIONS,
          tinyfish_exists: !!env.TINYFISH_API_KEY,
          message: env.AI
            ? "Workers AI binding is available."
            : "Workers AI binding is NOT available."
        }, 200, cors);
      }

      // ==================================================
      // وضعیت Worker
      // ==================================================
      if (url.pathname === "/" && request.method === "GET") {
        return response({
          ok: true,
          name: "Danyal AI",
          status: "online",
          tools: [
            "chat",
            "write",
            "code",
            "translate",
            "summarize",
            "research",
            "image"
          ],
          uploads: ["image", "file"],
          limit: "10 AI requests per hour"
        }, 200, cors);
      }

      // ==================================================
      // تحقیق قدیمی با ?q=
      // ==================================================
      if (request.method === "GET") {
        const q = url.searchParams.get("q");

        if (q) {
          if (!(await allowRequest(env))) {
            return response({
              error: "سقف ۱۰ درخواست در ساعت تکمیل شده است.",
              retry: "بعداً دوباره تلاش کنید."
            }, 429, cors);
          }

          return research(q, env, cors);
        }
      }

      if (request.method !== "POST") {
        return response({
          error: "فقط POST و GET پشتیبانی می‌شود."
        }, 405, cors);
      }

      // ==================================================
      // مسیر جدید: multipart/form-data (ارسال عکس/فایل)
      // API فعلی JSON دست‌نخورده باقی می‌ماند؛ این فقط یک مسیر موازی است.
      // ==================================================
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("multipart/form-data")) {
        return handleMultipart(request, env, cors);
      }

      // ==================================================
      // JSON
      // ==================================================
      let body;

      try {
        body = await request.json();
      } catch {
        return response({
          error: "JSON نامعتبر است."
        }, 400, cors);
      }

      const action = body.action || "chat";

      // ==================================================
      // قابلیت‌های AI
      // ==================================================
      const aiActions = [
        "chat",
        "write",
        "code",
        "translate",
        "summarize",
        "image"
      ];

      if (aiActions.includes(action)) {
        if (!(await allowRequest(env))) {
          return response({
            error: "سقف ۱۰ درخواست AI در این ساعت تکمیل شده است.",
            limit: 10
          }, 429, cors);
        }
      }

      // ==================================================
      // CHAT
      // ==================================================
      if (action === "chat") {
        return textAI(
          env,
          body,
          TEXT_MODEL,
          `تو Danyal AI هستی.

به زبان کاربر پاسخ بده.

پاسخ دقیق، مفید و طبیعی بده.

اطلاعات ساختگی ایجاد نکن.`,
          cors
        );
      }

      // ==================================================
      // WRITE
      // ==================================================
      if (action === "write") {
        return textAI(
          env,
          body,
          TEXT_MODEL,
          `تو یک نویسنده حرفه‌ای هستی.

مقاله، متن، نامه، تبلیغ، توضیح محصول و سایر متن‌ها را
مرتب، حرفه‌ای و خوانا تولید کن.

ساختار مناسب با عنوان و بخش‌بندی ایجاد کن.`,
          cors
        );
      }

      // ==================================================
      // CODE
      // ==================================================
      if (action === "code") {
        return textAI(
          env,
          body,
          CODE_MODEL,
          `تو یک برنامه‌نویس حرفه‌ای هستی.

کد کامل، قابل اجرا و تا حد ممکن امن تولید کن.

اگر لازم است فایل‌های مختلف پروژه را مشخص کن.

از توضیحات اضافی غیرضروری خودداری کن.`,
          cors
        );
      }

      // ==================================================
      // TRANSLATE
      // ==================================================
      if (action === "translate") {
        const text = body.text || body.prompt;
        const target = body.target || "Persian";

        if (!text) {
          return response({
            error: "متن ترجمه ارسال نشده است."
          }, 400, cors);
        }

        return textAI(
          env,
          {
            prompt: `متن زیر را به ${target} ترجمه کن:

${text}`
          },
          TEXT_MODEL,
          "فقط ترجمه دقیق و طبیعی را ارائه کن.",
          cors
        );
      }

      // ==================================================
      // SUMMARIZE
      // ==================================================
      if (action === "summarize") {
        const text = body.text || body.prompt;

        if (!text) {
          return response({
            error: "متن برای خلاصه‌سازی ارسال نشده است."
          }, 400, cors);
        }

        return textAI(
          env,
          {
            prompt: `متن زیر را خلاصه کن و نکات اصلی را استخراج کن:

${text}`
          },
          TEXT_MODEL,
          "خلاصه دقیق و بدون اضافه کردن اطلاعات ساختگی تولید کن.",
          cors
        );
      }

      // ==================================================
      // RESEARCH
      // ==================================================
      if (action === "research") {
        const q =
          body.q ||
          body.query ||
          body.prompt;

        if (!q) {
          return response({
            error: "موضوع تحقیق وارد نشده است."
          }, 400, cors);
        }

        // تحقیق با TinyFish سهمیه مدل AI را مصرف نمی‌کند.
        return research(q, env, cors);
      }

      // ==================================================
      // IMAGE (تولید تصویر)
      // ==================================================
      if (action === "image") {
        const prompt = body.prompt;

        if (!prompt) {
          return response({
            error: "توضیحات تصویر وارد نشده است."
          }, 400, cors);
        }

        if (!env.AI) {
          return response({
            error: "Workers AI binding در Runtime در دسترس نیست.",
            binding: "env.AI"
          }, 500, cors);
        }

        let result;
        try {
          result = await env.AI.run(
            IMAGE_MODEL,
            {
              prompt: prompt,
              steps: 4
            }
          );
        } catch (e) {
          return response({
            ok: false,
            error: "ساخت تصویر توسط مدل هوش مصنوعی ممکن نشد. لطفاً دوباره تلاش کنید.",
            details: errDetails(e)
          }, 500, cors);
        }

        if (!result || !result.image) {
          return response({
            ok: false,
            error: "تصویری از مدل هوش مصنوعی دریافت نشد. لطفاً دوباره تلاش کنید."
          }, 500, cors);
        }

        return response({
          ok: true,
          type: "image",
          model: IMAGE_MODEL,
          image: result.image,
          dataURI:
            "data:image/jpeg;base64," +
            result.image
        }, 200, cors);
      }

      // ==================================================
      // ابزار ناشناخته
      // ==================================================
      return response({
        error: "ابزار ناشناخته است.",
        available_actions: [
          "chat",
          "write",
          "code",
          "translate",
          "summarize",
          "research",
          "image"
        ]
      }, 400, cors);

    } catch (error) {
      return response({
        error: "خطای Worker",
        details: error?.message || String(error)
      }, 500, cors);
    }
  }
};


// ==================================================
// AI TEXT
// ==================================================

async function textAI(
  env,
  body,
  model,
  system,
  cors
) {
  if (!env.AI) {
    return response({
      error: "Workers AI binding در Runtime در دسترس نیست.",
      binding: "env.AI"
    }, 500, cors);
  }

  const messages = [];

  messages.push({
    role: "system",
    content: system
  });

  if (Array.isArray(body.messages)) {
    messages.push(...body.messages);
  } else {
    const prompt =
      body.prompt ||
      body.text ||
      body.message;

    if (!prompt) {
      return response({
        error: "پیام ارسال نشده است."
      }, 400, cors);
    }

    messages.push({
      role: "user",
      content: prompt
    });
  }

  const result = await env.AI.run(
    model,
    {
      messages,
      max_tokens: 2048
    }
  );

  return response({
    ok: true,
    type: "text",
    model,
    response:
      result.response ??
      result.result ??
      result
  }, 200, cors);
}


// ==================================================
// TINYFISH RESEARCH
// ==================================================

async function research(q, env, cors) {
  if (!env.TINYFISH_API_KEY) {
    return response({
      error: "TINYFISH_API_KEY تنظیم نشده است."
    }, 500, cors);
  }

  const searchUrl =
    "https://api.search.tinyfish.ai?query=" +
    encodeURIComponent(q);

  const r = await fetch(searchUrl, {
    method: "GET",
    headers: {
      "X-API-Key": env.TINYFISH_API_KEY,
      "Accept": "application/json"
    }
  });

  const text = await r.text();

  if (!r.ok) {
    return response({
      error: "TinyFish error",
      status: r.status,
      details: text
    }, r.status, cors);
  }

  let result;

  try {
    result = JSON.parse(text);
  } catch {
    result = text;
  }

  return response({
    ok: true,
    type: "research",
    query: q,
    result
  }, 200, cors);
}


// ==================================================
// 10 REQUEST / HOUR
// ==================================================

async function allowRequest(env) {
  if (!env.SESSIONS) {
    throw new Error(
      "Binding مربوط به SESSIONS وجود ندارد."
    );
  }

  const now = new Date();

  const hourKey =
    now.toISOString().slice(0, 13);

  const key =
    "ai-hour:" + hourKey;

  const current =
    Number(await env.SESSIONS.get(key)) || 0;

  if (current >= MAX_REQUESTS_PER_HOUR) {
    return false;
  }

  await env.SESSIONS.put(
    key,
    String(current + 1),
    {
      expirationTtl: 7200
    }
  );

  return true;
}


// ==================================================
// RESPONSE
// ==================================================

function response(data, status, cors) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        ...cors
      }
    }
  );
}

// برای فیلد تشخیصی "details" در پاسخ‌های خطا: اگر خطای پرتاب‌شده یک Error
// معمولی نباشد (مثلاً یک آبجکت ساده از سمت AI binding)، به‌جای رشته بی‌فایده‌ی
// "[object Object]"، خودِ ساختار را به‌صورت JSON نمایش می‌دهد.
function errDetails(e) {
  if (e && typeof e.message === "string") return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch (err) { return String(e); }
}


/* ====================================================================
   بخش جدید: ارسال عکس/فایل (multipart/form-data)
   ==================================================================== */

async function handleMultipart(request, env, cors) {
  if (!env.AI) {
    return response({
      error: "Workers AI binding در Runtime در دسترس نیست.",
      binding: "env.AI"
    }, 500, cors);
  }

  if (!(await allowRequest(env))) {
    return response({
      ok: false,
      error: "سقف ۱۰ درخواست AI در این ساعت تکمیل شده است.",
      limit: 10
    }, 429, cors);
  }

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return response({
      ok: false,
      error: "فرمت درخواست نامعتبر است."
    }, 400, cors);
  }

  const action = String(form.get("action") || "chat");
  const rawMessages = form.get("messages");
  const rawPrompt = form.get("prompt") || form.get("text") || "";
  const imageFile = form.get("image");
  const docFile = form.get("file");

  let baseMessages = null;
  if (typeof rawMessages === "string" && rawMessages.trim()) {
    try {
      const parsed = JSON.parse(rawMessages);
      if (Array.isArray(parsed)) baseMessages = parsed;
    } catch (e) {
      return response({
        ok: false,
        error: "ساختار messages نامعتبر است."
      }, 400, cors);
    }
  }
  if (!baseMessages) {
    baseMessages = [{ role: "user", content: String(rawPrompt || "") }];
  }

  const model = action === "code" ? CODE_MODEL : TEXT_MODEL;

  // ---------------- عکس ----------------
  if (imageFile && typeof imageFile === "object" && typeof imageFile.arrayBuffer === "function") {
    const mime = (imageFile.type || "").toLowerCase();
    const ext = (imageFile.name || "").split(".").pop().toLowerCase();

    const looksLikeImage = ALLOWED_IMAGE_TYPES[mime] || IMAGE_EXT_FALLBACK[ext];
    if (!looksLikeImage) {
      return response({
        ok: false,
        error: "فرمت تصویر پشتیبانی نمی‌شود. فرمت‌های مجاز: JPG، PNG، WEBP."
      }, 415, cors);
    }

    if (imageFile.size > MAX_IMAGE_BYTES) {
      return response({
        ok: false,
        error: `حجم تصویر بیش از حد مجاز است (حداکثر ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} مگابایت).`
      }, 413, cors);
    }

    let bytes;
    try {
      bytes = new Uint8Array(await imageFile.arrayBuffer());
    } catch (e) {
      return response({ ok: false, error: "خواندن فایل تصویر با خطا مواجه شد." }, 400, cors);
    }

    const outMime = ALLOWED_IMAGE_TYPES[mime] ? mime : (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
    const dataURI = "data:" + outMime + ";base64," + bytesToBase64(bytes);

    const messages = [
      {
        role: "system",
        content: "تو Danyal AI هستی. کاربر یک تصویر ارسال کرده است. تصویر را با دقت توضیح بده و اگر سوالی درباره‌ی آن پرسیده، مستقیم و کامل به زبان فارسی روان پاسخ بده."
      },
      ...baseMessages
    ];

    let result;
    try {
      result = await env.AI.run(VISION_MODEL, {
        messages,
        image: dataURI,
        max_tokens: 1024
      });
    } catch (e) {
      return response({
        ok: false,
        error: "پردازش تصویر توسط مدل هوش مصنوعی ممکن نشد.",
        details: errDetails(e)
      }, 500, cors);
    }

    return response({
      ok: true,
      type: "image",
      filename: imageFile.name || "",
      model: VISION_MODEL,
      response: result.response ?? result.result ?? result
    }, 200, cors);
  }

  // ---------------- فایل ----------------
  if (docFile && typeof docFile === "object" && typeof docFile.arrayBuffer === "function") {
    const mime = (docFile.type || "").toLowerCase();
    const ext = (docFile.name || "").split(".").pop().toLowerCase();
    const kind = ALLOWED_FILE_MIME[mime] || (ALLOWED_FILE_EXT[ext] ? ext : null);

    if (!kind) {
      return response({
        ok: false,
        error: "نوع این فایل پشتیبانی نمی‌شود. فرمت‌های مجاز: PDF، TXT، CSV، JSON، DOCX، XLSX."
      }, 415, cors);
    }

    if (docFile.size > MAX_FILE_BYTES) {
      return response({
        ok: false,
        error: `حجم فایل بیش از حد مجاز است (حداکثر ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} مگابایت).`
      }, 413, cors);
    }

    let bytes;
    try {
      bytes = new Uint8Array(await docFile.arrayBuffer());
    } catch (e) {
      return response({ ok: false, error: "خواندن فایل با خطا مواجه شد." }, 400, cors);
    }

    let extracted = "";
    try {
      extracted = await extractFileText(kind, bytes);
    } catch (e) {
      return response({
        ok: false,
        error: "امکان استخراج متن از این فایل وجود نداشت. لطفاً فایل دیگری امتحان کنید یا محتوای آن را به‌صورت متن ارسال کنید.",
        details: errDetails(e)
      }, 422, cors);
    }

    if (!extracted || !extracted.trim()) {
      return response({
        ok: false,
        error: "متنی از این فایل استخراج نشد (ممکن است فایل اسکن‌شده، خالی یا رمزگذاری‌شده باشد)."
      }, 422, cors);
    }

    if (extracted.length > MAX_EXTRACTED_CHARS) {
      extracted = extracted.slice(0, MAX_EXTRACTED_CHARS) + "\n...[متن کوتاه شد]";
    }

    const lastIdx = baseMessages.length - 1;
    const userText = (lastIdx >= 0 && baseMessages[lastIdx].role === "user")
      ? baseMessages[lastIdx].content
      : String(rawPrompt || "این فایل را بررسی کن.");

    const combinedUserTurn = {
      role: "user",
      content:
        `محتوای فایل «${docFile.name || "فایل"}» به صورت زیر استخراج شده است:\n\n"""\n${extracted}\n"""\n\nدرخواست کاربر: ${userText || "این فایل را بررسی و خلاصه کن."}`
    };

    const historyMessages = lastIdx >= 0 && baseMessages[lastIdx].role === "user"
      ? baseMessages.slice(0, lastIdx)
      : baseMessages;

    const messages = [
      {
        role: "system",
        content: "تو Danyal AI هستی. متن استخراج‌شده از فایل ارسالی کاربر در ادامه آمده؛ بر اساس همین محتوا و درخواست کاربر پاسخ دقیق و مفید بده. اطلاعات ساختگی اضافه نکن."
      },
      ...historyMessages,
      combinedUserTurn
    ];

    let result;
    try {
      result = await env.AI.run(model, {
        messages,
        max_tokens: 2048
      });
    } catch (e) {
      return response({
        ok: false,
        error: "پردازش فایل توسط مدل هوش مصنوعی ممکن نشد.",
        details: errDetails(e)
      }, 500, cors);
    }

    return response({
      ok: true,
      type: "file",
      filename: docFile.name || "",
      model,
      response: result.response ?? result.result ?? result
    }, 200, cors);
  }

  // ---------------- نه عکس نه فایل: فقط متن (سازگاری) ----------------
  const messages = [
    { role: "system", content: "تو Danyal AI هستی. به زبان کاربر پاسخ بده. پاسخ دقیق و مفید بده." },
    ...baseMessages
  ];

  let result;
  try {
    result = await env.AI.run(model, { messages, max_tokens: 2048 });
  } catch (e) {
    return response({ ok: false, error: "پردازش پیام ممکن نشد.", details: errDetails(e) }, 500, cors);
  }

  return response({
    ok: true,
    type: "text",
    model,
    response: result.response ?? result.result ?? result
  }, 200, cors);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function extractFileText(kind, bytes) {
  if (kind === "txt") {
    return new TextDecoder("utf-8").decode(bytes);
  }
  if (kind === "json") {
    const raw = new TextDecoder("utf-8").decode(bytes);
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      return raw; // اگر JSON استاندارد نبود، همان متن خام برگردانده می‌شود
    }
  }
  if (kind === "csv") {
    return new TextDecoder("utf-8").decode(bytes);
  }
  if (kind === "docx") {
    return await extractDocx(bytes);
  }
  if (kind === "xlsx") {
    return await extractXlsx(bytes);
  }
  if (kind === "pdf") {
    return fixBidiText(await extractPdf(bytes));
  }
  throw new Error("نوع فایل پشتیبانی نمی‌شود.");
}


/* ====================================================================
   ZIP کوچک (برای خواندن DOCX / XLSX که خودشان یک فایل ZIP هستند)
   ==================================================================== */

function readUInt32LE(buf, off) { return buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] * 0x1000000); }
function readUInt16LE(buf, off) { return buf[off] | (buf[off + 1] << 8); }

function findEOCD(buf) {
  const sig = 0x06054b50;
  const maxBack = Math.min(buf.length, 65557);
  for (let i = buf.length - 22; i >= buf.length - maxBack; i--) {
    if (i < 0) break;
    if (readUInt32LE(buf, i) === sig) return i;
  }
  throw new Error("فایل ZIP/DOCX/XLSX معتبر نیست.");
}

function listZipEntries(buf) {
  const eocd = findEOCD(buf);
  const cdOffset = readUInt32LE(buf, eocd + 16);
  const cdEntries = readUInt16LE(buf, eocd + 10);
  const entries = [];
  let ptr = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    const sig = readUInt32LE(buf, ptr);
    if (sig !== 0x02014b50) throw new Error("ساختار Central Directory نامعتبر است.");
    const compMethod = readUInt16LE(buf, ptr + 10);
    const compSize = readUInt32LE(buf, ptr + 20);
    const nameLen = readUInt16LE(buf, ptr + 28);
    const extraLen = readUInt16LE(buf, ptr + 30);
    const commentLen = readUInt16LE(buf, ptr + 32);
    const localOffset = readUInt32LE(buf, ptr + 42);
    const name = new TextDecoder("utf-8").decode(buf.subarray(ptr + 46, ptr + 46 + nameLen));
    entries.push({ name, compMethod, compSize, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function readZipEntry(buf, entry) {
  const lh = entry.localOffset;
  if (readUInt32LE(buf, lh) !== 0x04034b50) throw new Error("Local Header نامعتبر است.");
  const nameLen = readUInt16LE(buf, lh + 26);
  const extraLen = readUInt16LE(buf, lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const compData = buf.subarray(dataStart, dataStart + entry.compSize);
  if (entry.compMethod === 0) return compData;
  if (entry.compMethod === 8) return await inflateRaw(compData);
  throw new Error("روش فشرده‌سازی پشتیبانی نمی‌شود.");
}

async function getZipFile(buf, entries, name) {
  const e = entries.find(x => x.name === name);
  if (!e) return null;
  return readZipEntry(buf, e);
}

function decodeXmlEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

async function extractDocx(buf) {
  const entries = listZipEntries(buf);
  const docXmlBytes = await getZipFile(buf, entries, "word/document.xml");
  if (!docXmlBytes) throw new Error("word/document.xml در فایل یافت نشد.");
  let xml = new TextDecoder("utf-8").decode(docXmlBytes);
  xml = xml.replace(/<\/w:p>/g, "\n");
  xml = xml.replace(/<w:tab\/>/g, "\t");
  xml = xml.replace(/<w:br\s*\/?>/g, "\n");
  xml = xml.replace(/<[^>]+>/g, "");
  xml = decodeXmlEntities(xml);
  return xml.replace(/\n{3,}/g, "\n\n").trim();
}

// یک محافظ زمانی ساده: اگر پردازش یک فایل خیلی طول بکشد، Cloudflare خودش
// Worker را به‌خاطر عبور از محدودیت CPU متوقف می‌کند و کاربر یک خطای ۵۰۰ خام
// (بدون JSON) می‌بیند. برای جلوگیری از این حالت، حلقه‌های سنگین (Regex روی
// فایل‌های بزرگ) هر چند تکرار یک‌بار زمان را چک می‌کنند و اگر از سقف رد شدند،
// با همان متنِ تا‌این‌لحظه‌استخراج‌شده (یا خطای تمیز) برمی‌گردند؛ به‌جای این‌که
// Cloudflare خودش وسط کار Worker را بکشد.
function makeBudget(ms) {
  const deadline = Date.now() + ms;
  return () => Date.now() > deadline;
}
const EXTRACTION_TIME_BUDGET_MS = 8000;

async function extractXlsx(buf) {
  const overBudget = makeBudget(EXTRACTION_TIME_BUDGET_MS);
  const entries = listZipEntries(buf);
  let sharedStrings = [];
  const ssBytes = await getZipFile(buf, entries, "xl/sharedStrings.xml");
  if (ssBytes) {
    const ssXml = new TextDecoder("utf-8").decode(ssBytes);
    const siBlocks = ssXml.match(/<si>[\s\S]*?<\/si>/g) || [];
    sharedStrings = siBlocks.map(block => {
      const texts = [...block.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => decodeXmlEntities(m[1]));
      return texts.join("");
    });
  }

  const sheetEntries = entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const sheetsOut = [];
  let truncated = false;
  outer:
  for (const se of sheetEntries.slice(0, 5)) {
    const bytes = await readZipEntry(buf, se);
    const xml = new TextDecoder("utf-8").decode(bytes);
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)];
    const lines = [];
    let rowCount = 0;
    for (const rowMatch of rows) {
      rowCount++;
      if (rowCount % 200 === 0 && overBudget()) { truncated = true; break outer; }
      const cells = [...rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)];
      const values = cells.map(c => {
        const attrs = c[1];
        const typeMatch = attrs.match(/\st="([^"]*)"/);
        const type = typeMatch ? typeMatch[1] : null;
        const inner = c[2];
        if (type === "s") {
          const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
          const idx = vMatch ? parseInt(vMatch[1], 10) : -1;
          return sharedStrings[idx] ?? "";
        } else if (type === "inlineStr") {
          const tMatch = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
          return tMatch ? decodeXmlEntities(tMatch[1]) : "";
        } else {
          const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
          return vMatch ? vMatch[1] : "";
        }
      });
      lines.push(values.join("\t"));
    }
    if (lines.length) sheetsOut.push(lines.join("\n"));
  }
  let out = sheetsOut.join("\n\n").trim();
  if (truncated) out += "\n...[فایل بزرگ بود؛ فقط بخشی از آن پردازش شد]";
  return out;
}


/* ====================================================================
   استخراج متن از PDF (بهترین تلاش ممکن - Best Effort)
   محدودیت شناخته‌شده: برای PDFهای اسکن‌شده (تصویر) یا رمزگذاری‌شده کار نمی‌کند.
   ==================================================================== */

async function zlibInflate(bytes) {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function bytesToLatin1(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return s;
}

function unescapePdfString(s) {
  return s
    .replace(/\\([nrtbf()\\])/g, (m, c) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" }[c]))
    .replace(/\\(\d{1,3})/g, (m, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function parseCMap(cmapText, targetMap, state) {
  const csrMatch = cmapText.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/);
  if (csrMatch && state) state.codeLen = csrMatch[1].length;

  const charBlocks = cmapText.match(/beginbfchar([\s\S]*?)endbfchar/g) || [];
  for (const block of charBlocks) {
    const pairs = [...block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)];
    for (const [, srcHex, dstHex] of pairs) {
      targetMap.set(srcHex.toUpperCase(), hexToUtf16Str(dstHex));
    }
  }
  const rangeBlocks = cmapText.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
  for (const block of rangeBlocks) {
    const entries = [...block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)];
    for (const [, loHex, hiHex, dstHex, arr] of entries) {
      const lo = parseInt(loHex, 16), hi = parseInt(hiHex, 16);
      const width = loHex.length;
      if (dstHex) {
        const base = parseInt(dstHex, 16);
        for (let code = lo; code <= hi && code - lo < 65536; code++) {
          targetMap.set(code.toString(16).toUpperCase().padStart(width, "0"), String.fromCodePoint(base + (code - lo)));
        }
      } else if (arr) {
        const dsts = [...arr.matchAll(/<([0-9a-fA-F]+)>/g)].map(m => m[1]);
        for (let i = 0; i < dsts.length && lo + i <= hi; i++) {
          targetMap.set((lo + i).toString(16).toUpperCase().padStart(width, "0"), hexToUtf16Str(dsts[i]));
        }
      }
    }
  }
}

function hexToUtf16Str(hex) {
  let out = "";
  for (let i = 0; i < hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  }
  return out;
}

function decodeHexShowString(hex, cmap, codeLen) {
  let out = "";
  for (let i = 0; i + codeLen <= hex.length; i += codeLen) {
    const code = hex.slice(i, i + codeLen).toUpperCase();
    if (cmap.has(code)) out += cmap.get(code);
  }
  return out;
}

async function extractPdf(buf) {
  const latin1 = bytesToLatin1(buf);
  // جست‌وجوی هر stream فقط درون محدوده‌ی "N G obj ... endobj" مربوط به خودش،
  // تا Regex مربوط به دیکشنری هرگز از یک آبجکت به آبجکت دیگر "نشتی" نکند.
  const objRe = /\d+\s+\d+\s+obj([\s\S]*?)endobj/g;
  const innerStreamRe = /<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/;

  async function decodeStream(dict, bodyStr) {
    const bodyBytes = new Uint8Array(bodyStr.length);
    for (let i = 0; i < bodyStr.length; i++) bodyBytes[i] = bodyStr.charCodeAt(i) & 0xff;
    if (/\/FlateDecode/.test(dict)) {
      try { return await zlibInflate(bodyBytes); } catch (e) { return null; }
    } else if (/\/Filter/.test(dict)) {
      return null; // فیلترهای دیگر (مثل تصاویر DCTDecode) پشتیبانی نمی‌شوند
    }
    return bodyBytes;
  }

  const overBudget = makeBudget(EXTRACTION_TIME_BUDGET_MS);
  const cmap = new Map();
  const cmapState = { codeLen: 4 };
  const contentStreams = [];
  let objMatch;
  let objCount = 0;
  let pass1Truncated = false;
  while ((objMatch = objRe.exec(latin1)) !== null) {
    objCount++;
    if (objCount % 50 === 0 && overBudget()) { pass1Truncated = true; break; }
    const match = innerStreamRe.exec(objMatch[1]);
    if (!match) continue;
    const raw = await decodeStream(match[1], match[2]);
    if (!raw) continue;
    const text = bytesToLatin1(raw);
    if (text.includes("beginbfchar") || text.includes("beginbfrange")) {
      parseCMap(text, cmap, cmapState);
    } else if (text.includes("Tj") || text.includes("TJ")) {
      contentStreams.push(text);
    }
  }

  let allText = "";
  let pass2Truncated = false;
  streamLoop:
  for (const content of contentStreams) {
    const showRe = /(\(((?:[^()\\]|\\.)*)\)|<([0-9a-fA-F]*)>)\s*(Tj|TJ)|\[((?:[^\[\]])*)\]\s*TJ/g;
    let tm;
    let matchCount = 0;
    while ((tm = showRe.exec(content)) !== null) {
      matchCount++;
      if (matchCount % 300 === 0 && overBudget()) { pass2Truncated = true; break streamLoop; }
      if (tm[4] === "Tj") {
        if (tm[2] !== undefined) allText += unescapePdfString(tm[2]);
        else if (tm[3] !== undefined) allText += decodeHexShowString(tm[3], cmap, cmapState.codeLen);
      } else if (tm[5] !== undefined) {
        const arrContent = tm[5];
        const pieceRe = /\(((?:[^()\\]|\\.)*)\)|<([0-9a-fA-F]*)>/g;
        let pm;
        while ((pm = pieceRe.exec(arrContent)) !== null) {
          if (pm[1] !== undefined) allText += unescapePdfString(pm[1]);
          else if (pm[2] !== undefined) allText += decodeHexShowString(pm[2], cmap, cmapState.codeLen);
        }
      }
      allText += " ";
    }
    allText += "\n";
  }
  let out = allText.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (pass1Truncated || pass2Truncated) out += "\n...[فایل بزرگ/پیچیده بود؛ فقط بخشی از آن پردازش شد]";
  return out;
}

// PDF متن راست‌به‌چپ (فارسی/عربی) را در ترتیب دیداری (چپ‌به‌راست) ذخیره می‌کند،
// بنابراین بعد از استخراج معکوس به نظر می‌رسد. این تابع با یک اصلاح ساده،
// فقط بخش‌های راست‌به‌چپ را معکوس می‌کند و اعداد/کلمات لاتین را دست‌نخورده نگه می‌دارد.
function fixBidiLine(line) {
  const isRtl = ch => /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(ch);
  const runs = [];
  let cur = "", curType = null;
  for (const ch of line) {
    const t = isRtl(ch) ? "rtl" : "other";
    if (t !== curType && cur) { runs.push({ type: curType, text: cur }); cur = ""; }
    curType = t;
    cur += ch;
  }
  if (cur) runs.push({ type: curType, text: cur });
  const rtlRunCount = runs.filter(r => r.type === "rtl").length;
  if (rtlRunCount === 0) return line;
  return runs.reverse().map(r => r.type === "rtl" ? [...r.text].reverse().join("") : r.text).join("");
}

function fixBidiText(text) {
  return text.split("\n").map(fixBidiLine).join("\n");
}
