// اسپک پین‌شده لوکال — هیچ درخواستی به سرور بیرونی زده نمی‌شود
const LOCAL_SPEC = {
  v: 1,
  origin: 'https://flow.google.com',
  path: '/_/AiSandboxAngularFrontend/data/batchexecute',
  rpcids: 'cPZSdc',
  tag: 'wrb.fr',
  flagIndex: 30,
  minLength: 32
};

// تنظیمات تزریق مستقیم اسکریپت به محیط اصلی صفحه گوگل
const registration = {
  id: 'flow-helper',
  matches: ['https://flow.google.com/*'],
  js: ['engine.js'],
  runAt: 'document_start',
  world: 'MAIN',
  persistAcrossSessions: true
};

const REGISTRATIONS = [registration];
const REGISTRATION_IDS = REGISTRATIONS.map(item => item.id);

// همان قراردادی که engine.js انتظار دارد
function isValidSpec(spec) {
  return !!spec &&
    typeof spec === 'object' &&
    typeof spec.path === 'string' && spec.path.startsWith('/') &&
    typeof spec.rpcids === 'string' && spec.rpcids.length > 0 &&
    typeof spec.tag === 'string' && spec.tag.length > 0 &&
    Number.isInteger(spec.flagIndex) && spec.flagIndex >= 0 &&
    Number.isInteger(spec.minLength) && spec.minLength > spec.flagIndex;
}

// بازگرداندن اسپک لوکال (بدون شبکه)
async function fetchSpec() {
  return isValidSpec(LOCAL_SPEC) ? LOCAL_SPEC : null;
}

// تابع فعال‌سازی خودکار و اطمینان از ثبت بودن اسکریپت
async function ensureScriptRegistered() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: REGISTRATION_IDS });
    if (existing.length === 0) {
      await chrome.scripting.registerContentScripts(REGISTRATIONS);
      console.log('Flow Shield: موتور پچ با موفقیت فعال شد.');
    }
  } catch (err) {
    console.error('Flow Shield: خطا در ثبت اسکریپت:', err.message);
  }
}

// ۱. فعال‌سازی خودکار هنگام نصب یا به‌روزرسانی افزونه
chrome.runtime.onInstalled.addListener(async () => {
  await ensureScriptRegistered();
});

// ۲. فعال‌سازی خودکار هنگام باز شدن مرورگر
if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(async () => {
    await ensureScriptRegistered();
  });
}

// ۳. اجرای فوری در لحظه لود پس‌زمینه (جهت اطمینان در حالت تست و دیباگ)
ensureScriptRegistered();

// مدیریت ارتباطات و پیام‌های دریافتی بین تب‌ها و پنل افزونه
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // اعتبارسنجی فرستنده جهت جلوگیری از دریافت پیام‌های غیرمجاز
  if (sender.id !== chrome.runtime.id) return;

  // ارسال کانفیگ به تب فعال گوگل فلو
  if (message?.type === 'getSpec') {
    fetchSpec().then(spec => {
      sendResponse({ ok: !!spec, spec: spec });
    });
    return true; // فعال نگه‌داشتن پورت برای پاسخ ناهمگام (Async)
  }

  // تغییر وضعیت (خاموش/روشن) دستی از داخل پاپ‌آپ
  if (!sender.tab && message?.type === 'setEnabled') {
    (async () => {
      const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: REGISTRATION_IDS });

      if (message.enabled && scripts.length === 0) {
        await chrome.scripting.registerContentScripts(REGISTRATIONS);
      } else if (!message.enabled && scripts.length > 0) {
        await chrome.scripting.unregisterContentScripts({ ids: REGISTRATION_IDS });
      }

      sendResponse({ ok: true });
    })().catch(err => {
      sendResponse({ ok: false, error: err.message });
    });

    return true; // فعال نگه‌داشتن پورت برای پاسخ ناهمگام (Async)
  }
});