const form = document.querySelector('#chat-form');
const input = document.querySelector('#question');
const sendButton = document.querySelector('#send');
const messages = document.querySelector('#messages');
const suggestions = document.querySelector('#suggestions');

// Conversation history sent with each request so follow-up questions work.
// Only the most recent turns are sent; the server enforces the same limit.
const MAX_HISTORY_MESSAGES = 10;
const history = [];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.dir = 'auto'; // right-to-left text (e.g. Arabic) renders correctly
  el.textContent = text; // textContent, never innerHTML: model output is untrusted
  messages.appendChild(el);
  el.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'end' });
  return el;
}

async function ask(question) {
  suggestions.hidden = true;
  addMessage('user', question);
  const pending = addMessage('bot pending', 'Thinking...');
  sendButton.disabled = true;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question, history: history.slice(-MAX_HISTORY_MESSAGES) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed.');

    pending.className = 'msg bot';
    pending.textContent = data.reply;
    if (data.sources?.length) {
      const list = document.createElement('div');
      list.className = 'sources';
      list.textContent = 'Sources: ' + data.sources.map((s) => `${s.title} (${s.year})`).join(' · ');
      pending.appendChild(list);
    }
    history.push({ role: 'user', content: question }, { role: 'assistant', content: data.reply });
  } catch (err) {
    pending.className = 'msg bot error';
    pending.textContent = err.message || 'Sorry, something went wrong. Please try again.';
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const question = input.value.trim();
  if (!question || sendButton.disabled) return;
  input.value = '';
  ask(question);
});

suggestions.addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON') ask(e.target.textContent);
});
