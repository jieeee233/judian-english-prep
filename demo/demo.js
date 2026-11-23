const vocabulary = [
  { word: 'shelter', meaning: '庇护处', phrase: 'take shelter', prompt: 'We took ___ from the rain in the library.', options: ['shelter', 'window', 'gesture'] },
  { word: 'gesture', meaning: '举动', phrase: 'a kind gesture', prompt: 'Moving her books was a kind ___.', options: ['library', 'gesture', 'rain'] },
  { word: 'unfamiliar', meaning: '不熟悉的', phrase: 'an unfamiliar place', prompt: 'The new school felt ___ at first.', options: ['quietly', 'shelter', 'unfamiliar'] }
];

const byId = id => document.getElementById(id);
const saved = new Set();
const filter = byId('filter');
const practice = byId('practice');

function connectTabs(attribute) {
  const buttons = document.querySelectorAll(`[data-${attribute}]`);
  function select(id) {
    for (const button of buttons) {
      const section = button.dataset[attribute];
      button.setAttribute('aria-pressed', String(section === id));
      byId(section).hidden = section !== id;
    }
  }
  for (const button of buttons) {
    button.addEventListener('click', () => select(button.dataset[attribute]));
  }
  return select;
}

const showView = connectTabs('view');
const showAnalysis = connectTabs('tab');

byId('open-record').addEventListener('click', () => {
  showView('analysis');
  showAnalysis('sentence');
  document.querySelector('[data-tab="sentence"]').focus();
});

for (const button of document.querySelectorAll('[data-locate]')) {
  button.addEventListener('click', () => {
    document.querySelector('.located')?.classList.remove('located');
    const paragraph = byId(button.dataset.locate);
    paragraph.classList.add('located');
    paragraph.focus();
  });
}

function makeButton(label, action) {
  const button = document.createElement('button');
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function wordRow(entry, actionLabel, action) {
  const row = document.createElement('div');
  row.className = 'word';
  const text = document.createElement('span');
  text.textContent = `${entry.word} · ${entry.meaning} · ${entry.phrase}`;
  row.append(text, makeButton(actionLabel, action));
  return row;
}

function updateSaved() {
  byId('count').textContent = saved.size;
  byId('start-practice').disabled = !saved.size;
  const query = filter.value.trim().toLowerCase();
  const matches = vocabulary.filter(entry => saved.has(entry) &&
    `${entry.word} ${entry.meaning}`.toLowerCase().includes(query));
  byId('saved-list').replaceChildren(...matches.map(entry =>
    wordRow(entry, '移除', () => {
      toggleSaved(entry);
      filter.focus();
    })));
  if (!matches.length) {
    const message = document.createElement('p');
    message.textContent = saved.size ? '没有匹配的词条。' : '在文章解析的「重点词汇」中收藏词条后，它们会显示在这里。';
    byId('saved-list').append(message);
  }
}

const saveButtons = new Map();
function toggleSaved(entry) {
  const adding = !saved.has(entry);
  if (adding) saved.add(entry);
  else saved.delete(entry);
  saveButtons.get(entry).textContent = adding ? '取消收藏' : '收藏词条';
  saveButtons.get(entry).setAttribute('aria-pressed', String(adding));
  byId('status').textContent = adding ? `已收藏 ${entry.word}` : `已移除 ${entry.word}`;
  practice.hidden = true;
  updateSaved();
}

for (const entry of vocabulary) {
  const row = wordRow(entry, '收藏词条', () => toggleSaved(entry));
  const button = row.querySelector('button');
  button.setAttribute('aria-pressed', 'false');
  saveButtons.set(entry, button);
  byId('vocab-list').append(row);
}
filter.addEventListener('input', updateSaved);
updateSaved();

byId('start-practice').addEventListener('click', () => {
  const entries = [...saved];
  let correct = 0;
  function showQuestion(index) {
    const title = document.createElement('h3');
    if (index === entries.length) {
      title.textContent = `练习完成，答对 ${correct} / ${entries.length} 题`;
      title.tabIndex = -1;
      practice.replaceChildren(title);
      title.focus();
      return;
    }
    const entry = entries[index];
    title.textContent = `第 ${index + 1} / ${entries.length} 题`;
    title.tabIndex = -1;
    const prompt = document.createElement('p');
    prompt.lang = 'en';
    prompt.textContent = entry.prompt;
    const options = document.createElement('nav');
    options.setAttribute('aria-label', '选择答案');
    const result = document.createElement('p');
    result.setAttribute('role', 'status');
    const next = makeButton(index + 1 === entries.length ? '查看结果' : '下一题', () => showQuestion(index + 1));
    next.hidden = true;
    for (const option of entry.options) {
      options.append(makeButton(option, () => {
        if (option === entry.word) correct++;
        result.textContent = option === entry.word ? '回答正确。' : `正确答案是 ${entry.word}。`;
        for (const button of options.querySelectorAll('button')) button.disabled = true;
        next.hidden = false;
        next.focus();
      }));
    }
    practice.replaceChildren(title, prompt, options, result, next);
    title.focus();
  }
  practice.hidden = false;
  showQuestion(0);
});
