const FLOW_URL = 'https://flow.google.com/';
const CONTENT_SCRIPT_ID = 'flow-helper';
const UNSUPPORTED_COUNTRY_PATH = '/unsupported-country';

const STATES = {
  'enabled': { dot: 'ok', strong: true, text: 'سپر حفاظتی فعال است. تب فلو را رفرش کنید.' },
  'disabled': { dot: 'idle', strong: false, text: 'سپر غیرفعال است.' },
  'active': { dot: 'ok', strong: true, text: 'رفع تحریم روی این تب با موفقیت اعمال شد.' },
  'armed': { dot: 'armed', strong: false, text: 'آماده‌باش؛ در انتظار دریافت پکت‌های تب...' },
  'awaitingSpec': { dot: 'armed', strong: false, text: 'در حال همگام‌سازی با هسته پچ...' },
  'specUnavailable': { dot: 'warn', strong: true, text: 'خطا در ارتباط با هسته پچ. اتصال را بررسی کنید.' },
  'schemaMismatch': { dot: 'bad', strong: true, text: 'ساختار فلو تغییر کرده؛ نیاز به آپدیت است.' },
  'reloadTab': { dot: 'warn', strong: false, text: 'برای اثرگذاری، تب فلو را بازنشانی کنید.' },
  'saved': { dot: 'ok', strong: true, text: 'تنظیمات ذخیره شد. تب را رفرش کنید.' }
};

const MSG_PICK_FLOW_TAB = 'لطفاً ابتدا به تب Google Flow بروید.';
const MSG_SAVE_FAILED = 'ذخیره تنظیمات با خطا مواجه شد.';

const toggle = document.getElementById('toggle');
const statusEl = document.getElementById('status');
const error = document.getElementById('error');
const reload = document.getElementById('reload');
const tabDetector = document.getElementById('tab-detector');
const helpBtn = document.getElementById('help-btn');
let tab;

function setStatus(a) {
  const b = STATES[a];
  if (!b) return;
  statusEl.classList.toggle('is-strong', b.strong);
  statusEl.querySelector('.status-dot').className = 'status-dot status-dot--' + b.dot;
  statusEl.querySelector('.status-text').textContent = b.text;
}

function setEnabled(a) {
  toggle.setAttribute('aria-checked', String(a));
}

async function init() {
  const a = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  const isEnabled = a.length > 0;
  setEnabled(isEnabled);
  
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isFlowTab = tab?.url?.startsWith(FLOW_URL);
  
  // اگر روی سایت Flow بودیم، باکس هوشمند نمایش داده می‌شود
  tabDetector.hidden = !isFlowTab;
  setStatus(isEnabled ? 'enabled' : 'disabled');

  if (isFlowTab && isEnabled) {
    try {
      const d = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
      if (d?.['applied']) {
        setStatus('active');
      } else if (d?.['state'] === 'armed') {
        setStatus('armed');
      } else if (d?.['state'] === 'awaiting-spec') {
        setStatus('awaitingSpec');
      } else if (d?.['state']?.startsWith('spec unavailable') || d?.['state']?.startsWith('spec invalid')) {
        setStatus('specUnavailable');
      } else if (d?.['state']?.startsWith('schema mismatch')) {
        setStatus('schemaMismatch');
      } else {
        setStatus('reloadTab');
      }
    } catch {
      setStatus('reloadTab');
    }
  }
  toggle.disabled = false;
}

// تغییر وضعیت کلید روشن/خاموش
toggle.addEventListener('click', async () => {
  const newState = toggle.getAttribute('aria-checked') !== 'true';
  toggle.disabled = true;
  error.textContent = '';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'setEnabled', enabled: newState });
    if (!res?.ok) throw new Error(res?.error || MSG_SAVE_FAILED);
    setEnabled(newState);
    setStatus('saved');
  } catch (err) {
    setEnabled(!newState);
    error.textContent = err.message;
  } finally {
    toggle.disabled = false;
  }
});

// باز کردن مستقیم فلو در تب جدید
document.getElementById('open').onclick = () => chrome.tabs.create({ url: FLOW_URL });

// دکمه باز کردن راهنما در هدر
helpBtn.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('info.html') });

// دکمه رفرش هوشمند تب جاری و حذف ریدایرکت unsupported-country
reload.onclick = async () => {
  try {
    const currentTab = await chrome.tabs.get(tab.id);
    if (!currentTab?.url?.startsWith(FLOW_URL)) throw new Error(MSG_PICK_FLOW_TAB);
    
    if (new URL(currentTab.url).pathname.endsWith(UNSUPPORTED_COUNTRY_PATH)) {
      const cleanUrl = new URL(currentTab.url);
      cleanUrl.pathname = cleanUrl.pathname.replace(/unsupported-country$/, '');
      await chrome.tabs.update(tab.id, { url: cleanUrl.href });
    } else {
      await chrome.tabs.reload(tab.id);
    }
    window.close();
  } catch (err) {
    error.textContent = err.message;
  }
};

init().catch(err => { error.textContent = err.message; });