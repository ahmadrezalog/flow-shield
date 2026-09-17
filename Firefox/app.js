// آدرس و تنظیمات دریافت مشخصات پچ
const SPEC_URL = 'https://flow.cfcnode.com/v1/flow-spec';
const SPEC_TTL_MS = 6 * 60 * 60 * 1000; // کش به مدت ۶ ساعت

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

let specCache = null;
let specFetchedAt = 0;
let specInFlight = null;

// دریافت داینامیک مشخصات دور زدن از سرور
async function fetchSpec() {
  const now = Date.now();
  if (specCache && (now - specFetchedAt < SPEC_TTL_MS)) {
    return specCache;
  }
  if (specInFlight) {
    return specInFlight;
  }

  specInFlight = (async () => {
    try {
      const response = await fetch(SPEC_URL, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('spec HTTP ' + response.status);
      }
      const data = await response.json();
      specCache = data;
      specFetchedAt = Date.now();
      return data;
    } catch (err) {
      console.warn('CFC Flow: دریافت spec ناموفق بود:', err.message);
      return specCache;
    } finally {
      specInFlight = null;
    }
  })();

  return specInFlight;
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