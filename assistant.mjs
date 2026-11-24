const get = id => document.getElementById(id);
const status = get('assistant-status');
let requests = [];
try { requests = JSON.parse(localStorage.getItem('studio-requests') || '[]'); } catch {}
function showRequests() {
  get('requests').replaceChildren(...requests.map(text => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
}
function select(id,value) {
  get(id).value = value;
  get(id).dispatchEvent(new Event('change'));
}
get('assistant-form').onsubmit = event => {
  event.preventDefault();
  const text = get('command').value.trim();
  const cmd = text.toLowerCase().replace(/[.!?]+$/,'');
  const key = cmd.match(/^(?:set |switch )?(?:flute )?(?:scale|key)(?: to)? ([a-g])(?: natural)?$/);
  if (key) select('key',String('c d ef g a b'.indexOf(key[1])));
  else if (/^(half speed|normal speed|full speed)$/.test(cmd)) select('speed',cmd==='half speed'?'.5':'1');
  else if (/^(larger|smaller) notes$/.test(cmd)) {
    const size = cmd.startsWith('larger')?'1.65rem':'1rem';
    document.documentElement.style.setProperty('--assistant-note-size',size);
    localStorage.setItem('studio-note-size',size);
  } else {
    if (!text) return;
    requests.push(text);
    localStorage.setItem('studio-requests',JSON.stringify(requests));
    showRequests();
    status.textContent = 'Saved for a code change.';
    return;
  }
  status.textContent = 'Applied: '+text;
};
get('dictate').onclick = async () => {
  const button = get('dictate');
  button.disabled = true;
  status.textContent = 'Listening on the Windows default microphone…';
  try {
    const response = await fetch('/dictate',{method:'POST'});
    if (!response.ok) throw new Error();
    const text = await response.text();
    if (text) get('command').value = text;
    status.textContent = text ? 'Review the command, then apply it.' : 'No speech detected. Try again or type.';
  } catch { status.textContent = 'Windows dictation unavailable. Type your request here.'; }
  finally { button.disabled = false; }
};
const savedSize = localStorage.getItem('studio-note-size');
if (savedSize) document.documentElement.style.setProperty('--assistant-note-size',savedSize);
showRequests();
