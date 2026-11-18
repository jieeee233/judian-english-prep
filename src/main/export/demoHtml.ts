import type { DemoItem } from '../../shared/types';

/**
 * 生成可双击打开的自包含演示文件（无外部依赖，一体机浏览器直接打开）。
 *
 * 四个界面：
 * 1. 单词概览（顶部标签可切「词汇概览 / 搭配练习」）
 * 2. 练习题目概览（概览视图的第二个标签页）
 * 3. 单词卡（左右 15% 区域点击翻页，带「去练习 →」）
 * 4. 单词练习题页（返回键按来源回到单词卡或练习概览）
 *
 * 排版参考背单词 App：大字号、充足留白、柔和阴影，固定搭配单独成块。
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeScript(value: string): string {
  return value.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function buildDemoHtml(title: string, items: DemoItem[]): string {
  const safeTitle = escapeHtml(title || '单词演示');
  const data = items.map((item, index) => ({
    order: item.order || index + 1,
    word: item.word,
    ipa: item.ipa ?? '',
    pos: item.pos ?? '',
    meaning: item.meaning ?? '',
    collocations: (item.collocations ?? []).map((entry) => ({
      p: entry.pattern ?? '',
      m: entry.meaning ?? '',
    })),
    exercises: (item.exercises ?? []).map((entry) => ({
      id: entry.id,
      type: entry.type,
      point: entry.point ?? '',
      stem: entry.stem ?? '',
      answer: entry.answer ?? '',
      hint: entry.hint ?? '',
      explanation: entry.explanation ?? '',
      options: entry.options ?? [],
    })),
  }));

  const json = escapeScript(JSON.stringify(data));
  const withPractice = data.filter((item) => item.exercises.length).length;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<style>
  :root {
    --ink: #22332f;
    --ink-soft: #3d534d;
    --muted: #6f837f;
    --muted-light: #9aaba6;
    --deep: #163b34;
    --deep-2: #24564c;
    --sage: #e3efd4;
    --sage-soft: #f1f7e7;
    --sage-2: #c6dda4;
    --ok: #2f6b4f;
    --ok-bg: #eaf5ee;
    --danger: #a5433a;
    --danger-bg: #fbeeec;
    --line: #e6ebe4;
    --card: #ffffff;
    --serif: Georgia, "Times New Roman", "Songti SC", serif;
  }

  * { box-sizing: border-box; }

  html, body { height: 100%; margin: 0; }

  body {
    overflow: hidden;
    color: var(--ink);
    font-family: "Segoe UI", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
    background:
      radial-gradient(1200px 600px at 12% -10%, #f4f9ec 0%, rgba(244,249,236,0) 60%),
      linear-gradient(180deg, #f8faf5 0%, #eef4e6 55%, #e8f0de 100%);
  }

  button { font: inherit; color: inherit; }

  /* ---------------------------- 顶栏 ---------------------------- */

  .top {
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 18px;
    height: 68px;
    padding: 0 26px;
    background: rgba(255, 255, 255, 0.82);
    border-bottom: 1px solid rgba(228, 236, 224, 0.9);
    backdrop-filter: blur(10px);
  }

  .brand { display: flex; align-items: center; gap: 11px; min-width: 0; }

  .logo {
    display: grid;
    place-items: center;
    width: 36px; height: 36px;
    color: #f6fbef;
    font-family: var(--serif);
    font-size: 17px;
    font-weight: 700;
    background: var(--deep);
    border-radius: 11px;
  }

  .brand-text { min-width: 0; }

  .brand-text h1 {
    margin: 0;
    overflow: hidden;
    color: var(--deep);
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .brand-text p { margin: 2px 0 0; color: var(--muted-light); font-size: 11.5px; }

  .tabs {
    display: flex;
    gap: 4px;
    margin-left: 8px;
    padding: 4px;
    background: #eef3ea;
    border-radius: 12px;
  }

  .tab {
    padding: 7px 16px;
    color: var(--muted);
    font-size: 13.5px;
    background: none;
    border: 0;
    border-radius: 9px;
    cursor: pointer;
    transition: background 0.16s, color 0.16s;
  }

  .tab:hover { color: var(--deep); }

  .tab.active {
    color: var(--deep);
    font-weight: 600;
    background: #fff;
    box-shadow: 0 1px 3px rgba(22, 59, 52, 0.1);
  }

  .top-meta { margin-left: auto; color: var(--muted); font-size: 12.5px; white-space: nowrap; }

  /* ---------------------------- 视图容器 ---------------------------- */

  .view {
    position: fixed;
    top: 68px; left: 0; right: 0; bottom: 0;
    display: none;
    overflow: auto;
    overscroll-behavior: contain;
  }

  .view.active { display: block; }

  /* ---------------------------- 单词概览 ---------------------------- */

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 14px;
    padding: 24px 28px 122px;
  }

  .word-cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 16px 18px 15px;
    text-align: left;
    background: var(--card);
    border: 1px solid rgba(230, 235, 228, 0.9);
    border-radius: 18px;
    box-shadow: 0 1px 2px rgba(22, 59, 52, 0.04), 0 12px 26px -20px rgba(22, 59, 52, 0.5);
    cursor: pointer;
    transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
  }

  .word-cell:hover {
    transform: translateY(-2px);
    border-color: var(--sage-2);
    box-shadow: 0 2px 6px rgba(22, 59, 52, 0.06), 0 20px 40px -24px rgba(22, 59, 52, 0.55);
  }

  .cell-top { display: flex; align-items: baseline; gap: 8px; }

  .cell-order {
    color: var(--muted-light);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .cell-word {
    overflow: hidden;
    color: var(--deep);
    font-family: var(--serif);
    font-size: 22px;
    font-weight: 600;
    line-height: 1.25;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .cell-ipa { color: var(--muted-light); font-size: 12px; }

  .cell-meaning {
    display: -webkit-box;
    overflow: hidden;
    color: var(--ink-soft);
    font-size: 13px;
    line-height: 1.5;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .cell-colloc {
    display: -webkit-box;
    overflow: hidden;
    max-height: 60px;
    margin-top: 3px;
    padding: 5px 9px;
    color: var(--deep-2);
    font-size: 12px;
    line-height: 1.55;
    background: var(--sage-soft);
    border-radius: 8px;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }

  .cell-badge {
    align-self: flex-start;
    margin-top: 3px;
    padding: 1px 7px;
    color: var(--muted);
    font-size: 10.5px;
    background: #f2f5f1;
    border-radius: 20px;
  }

  /* 概览底部固定按钮：一体机屏幕高，老师不必够顶部 */
  .overview-foot {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    z-index: 20;
    display: flex;
    justify-content: center;
    padding: 18px 28px 22px;
    background: linear-gradient(180deg, rgba(238, 244, 230, 0) 0%, rgba(238, 244, 230, 0.92) 42%, #e8f0de 100%);
  }

  .btn-start {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 15px 44px;
    color: #f7fbf2;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.4px;
    background: var(--deep);
    border: 0;
    border-radius: 999px;
    box-shadow: 0 10px 26px -10px rgba(22, 59, 52, 0.6);
    cursor: pointer;
    transition: transform 0.16s ease, background 0.16s ease;
  }

  .btn-start:hover { transform: translateY(-1px); background: var(--deep-2); }
  .btn-start span { font-size: 18px; line-height: 1; }

  /* ---------------------------- 练习概览 ---------------------------- */

  .practice-list { padding: 22px 28px 40px; display: flex; flex-direction: column; gap: 14px; }

  .pword {
    padding: 16px 18px;
    background: var(--card);
    border: 1px solid rgba(230, 235, 228, 0.9);
    border-radius: 18px;
    box-shadow: 0 12px 26px -22px rgba(22, 59, 52, 0.5);
  }

  .pword-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }

  .pword-word { color: var(--deep); font-family: var(--serif); font-size: 24px; font-weight: 600; }
  .pword-pos { color: var(--muted); font-size: 12px; font-style: italic; }
  .pword-meaning { color: var(--ink-soft); font-size: 13.5px; }
  .pword-colloc {
    overflow: hidden;
    max-width: 52%;
    margin-left: auto;
    color: var(--deep-2);
    font-size: 12.5px;
    line-height: 1.5;
    text-align: right;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .qlist { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }

  /* ---------------------------- 题目卡 ---------------------------- */

  .q {
    padding: 14px 16px;
    background: #fbfdf9;
    border: 1px solid var(--line);
    border-radius: 14px;
  }

  .q-head { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }

  .q-tag {
    padding: 1px 8px;
    color: var(--deep-2);
    font-size: 10.5px;
    background: var(--sage-soft);
    border: 1px solid var(--sage-2);
    border-radius: 6px;
  }

  .q-tag.choice { color: #2b5875; background: #eef4f9; border-color: #cfdeeb; }

  .q-no { color: var(--muted-light); font-size: 11px; font-variant-numeric: tabular-nums; }
  .q-point { color: var(--muted-light); font-size: 11px; }

  .q-stem { margin: 0; color: var(--ink); font-size: 15px; line-height: 1.65; }

  .q-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }

  .q-opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 13px;
    color: var(--ink-soft);
    font-size: 14px;
    text-align: left;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 11px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
  }

  .q-opt:hover { border-color: var(--sage-2); background: var(--sage-soft); }
  .q-opt.correct { color: var(--ok); background: var(--ok-bg); border-color: #a9d2bb; font-weight: 600; }
  .q-opt.wrong { color: var(--danger); background: var(--danger-bg); border-color: #e8c2bd; }
  .q-opt.correct::after { content: "✓"; flex: none; color: var(--ok); font-weight: 700; }
  .q-opt.wrong::after { content: "✗"; flex: none; color: var(--danger); font-weight: 700; }

  .q-foot { display: flex; align-items: center; gap: 10px; margin-top: 10px; }

  .q-answer { color: var(--ok); font-size: 14px; font-weight: 600; }
  .q-answer.hide { display: none; }

  .q-note { margin: 8px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.6; }
  .q-note.hide { display: none; }

  .btn-ghost {
    padding: 5px 12px;
    color: var(--deep-2);
    font-size: 12.5px;
    background: #fff;
    border: 1px solid var(--sage-2);
    border-radius: 999px;
    cursor: pointer;
  }

  .btn-ghost:hover { background: var(--sage-soft); }

  /* ---------------------------- 单词卡 ---------------------------- */

  #view-card { overflow: hidden; }

  .zone {
    position: absolute;
    top: 0; bottom: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    cursor: pointer;
    transition: background 0.16s ease;
  }

  .zone.prev { left: 0; width: 15%; justify-content: flex-start; padding-left: 26px; }
  .zone.next { right: 0; width: 15%; justify-content: flex-end; padding-right: 26px; }
  .zone:hover { background: rgba(227, 239, 212, 0.35); }

  /* 翻页箭头做成圆钮，一体机上点得到、看得见 */
  .zone-arrow {
    display: grid;
    place-items: center;
    width: 54px;
    height: 54px;
    color: var(--deep-2);
    font-size: 30px;
    line-height: 1;
    background: rgba(255, 255, 255, 0.86);
    border: 1px solid var(--line);
    border-radius: 50%;
    box-shadow: 0 8px 20px rgba(31, 64, 54, 0.07);
    opacity: 0.8;
    transition: opacity 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
  }
  .zone:hover .zone-arrow { opacity: 1; transform: translateY(-1px) scale(1.05); box-shadow: 0 10px 24px rgba(31, 64, 54, 0.12); }

  .card {
    position: absolute;
    top: 24px;
    left: 15%;
    right: 15%;
    bottom: 96px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    /* 上内边距明显大于下边距：整组内容往下压，单词落在视觉中心略偏下 */
    padding: clamp(48px, 9vh, 104px) 56px clamp(28px, 4.5vh, 52px);
    text-align: center;
    background: var(--card);
    border-radius: 26px;
    box-shadow: 0 2px 6px rgba(22, 59, 52, 0.05), 0 32px 70px -40px rgba(22, 59, 52, 0.6);
  }

  /* 顶部元信息：第 N / M 词 · X 道练习 */
  .card-top {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-size: 17px;
    font-weight: 500;
    letter-spacing: 1px;
  }

  .card-top .dot { width: 5px; height: 5px; background: var(--sage-2); border-radius: 50%; }

  /* 返回导览页的图案按钮，放在卡片左上角 */
  .card-back {
    position: absolute;
    top: 44px;
    left: calc(15% + 20px);
    z-index: 30;
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    padding: 0;
    color: #fff;
    background: var(--deep-2);
    border: 1px solid var(--deep-2);
    border-radius: 50%;
    box-shadow: 0 8px 20px rgba(22, 59, 52, 0.22);
    cursor: pointer;
    transition: background 0.16s ease, transform 0.16s ease, border-color 0.16s ease;
  }

  .card-back:hover {
    background: var(--deep);
    border-color: var(--deep);
    transform: translateY(-1px);
  }

  .card-back svg { width: 20px; height: 20px; }

  .card-word {
    margin: clamp(18px, 3.2vh, 38px) 0 0;
    color: var(--deep);
    font-family: var(--serif);
    font-size: clamp(62px, 9.2vw, 148px);
    font-weight: 600;
    line-height: 1.08;
    letter-spacing: -0.5px;
  }

  .card-ipa {
    margin: 12px 0 0;
    color: var(--muted);
    font-size: clamp(22px, 2.4vw, 34px);
    letter-spacing: 0.6px;
  }

  .card-divider {
    width: 64px;
    height: 3px;
    margin: clamp(18px, 2.6vh, 30px) 0 clamp(16px, 2.2vh, 26px);
    background: var(--sage-2);
    border-radius: 3px;
  }

  .card-meaning {
    max-width: 880px;
    margin: 0;
    color: var(--ink);
    font-size: clamp(27px, 3.1vw, 44px);
    line-height: 1.5;
  }

  .card-pos {
    display: inline-block;
    margin-right: 8px;
    padding: 1px 8px;
    color: var(--deep-2);
    font-size: 0.5em;
    font-style: italic;
    vertical-align: middle;
    background: var(--sage-soft);
    border-radius: 6px;
  }

  /* 固定搭配紧跟在释义下方，靠近单词、不贴卡片底边 */
  .card-colloc {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 12px;
    align-items: center;
    justify-content: center;
    width: 100%;
    max-width: 900px;
    margin: clamp(26px, 4.2vh, 46px) 0 0;
  }

  .card-colloc h3 {
    flex: 0 0 100%;
    display: flex;
    gap: 14px;
    align-items: center;
    justify-content: center;
    margin: 0 0 2px;
    color: var(--muted);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 2.4px;
  }

  .card-colloc h3::before,
  .card-colloc h3::after { content: ""; flex: 0 0 44px; height: 1px; background: var(--line-strong, #dfe5dd); }

  .colloc-row {
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
    padding: 10px 18px;
    background: var(--sage-soft);
    border-radius: 999px;
  }

  .colloc-pattern { color: var(--deep-2); font-family: var(--serif); font-size: clamp(21px, 2.2vw, 30px); font-weight: 600; }
  .colloc-meaning { color: var(--muted); font-size: clamp(15px, 1.4vw, 19px); }

  .card-foot {
    position: absolute;
    left: 15%;
    right: 15%;
    bottom: 26px;
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .progress { flex: 1; height: 7px; background: #d9e4cd; border-radius: 999px; overflow: hidden; box-shadow: inset 0 1px 2px rgba(31, 64, 54, 0.08); }
  .progress span { display: block; height: 100%; width: 0; background: #a8c98a; border-radius: 999px; transition: width 0.24s ease; }

  .progress-text { min-width: 62px; color: var(--muted); font-size: 12.5px; text-align: right; font-variant-numeric: tabular-nums; }

  .btn-drill {
    padding: 11px 26px;
    color: #f7fbf2;
    font-size: 14px;
    font-weight: 600;
    background: var(--deep);
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.16s, transform 0.16s;
  }

  .btn-drill:hover { background: var(--deep-2); transform: translateY(-1px); }
  .btn-drill[disabled] { opacity: 0.5; filter: grayscale(0.75); cursor: default; transform: none; }

  /* ---------------------------- 练习页 ---------------------------- */

  .drill-wrap { max-width: 940px; margin: 0 auto; padding: 22px 28px 60px; }

  .drill-head { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }

  /* 返回做成图案按钮，和单词卡左上角保持一致 */
  .btn-back {
    display: grid;
    flex: none;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    color: var(--deep-2);
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.16s ease, border-color 0.16s ease;
  }

  .btn-back:hover { border-color: var(--sage-2); background: var(--sage-soft); }
  .btn-back svg { width: 18px; height: 18px; }

  .drill-title { color: var(--muted); font-size: 12.5px; }

  .drill-word {
    padding: 20px 24px;
    margin-bottom: 16px;
    background: var(--card);
    border-radius: 20px;
    box-shadow: 0 18px 40px -34px rgba(22, 59, 52, 0.55);
  }

  .drill-word h2 {
    margin: 0;
    color: var(--deep);
    font-family: var(--serif);
    font-size: 34px;
    font-weight: 600;
  }

  .drill-word p { margin: 6px 0 0; color: var(--ink-soft); font-size: 14px; }
  .drill-word .drill-colloc { margin-top: 8px; color: var(--deep-2); font-size: 12.5px; }

  .drill-list { display: flex; flex-direction: column; gap: 12px; }

  .empty-tip { padding: 40px 0; color: var(--muted); font-size: 14px; text-align: center; }

  @media (max-width: 900px) {
    .card { padding: 26px 28px; }
    .q-opts { grid-template-columns: 1fr; }
    .top-meta { display: none; }
  }
  .top { column-gap: clamp(12px, 2vw, 32px); }
  .word-cell, .pword, .card { border-radius: 14px; }
  .word-cell { padding: 18px; }
  .cell-word, .drill-word { line-height: 1.25; overflow-wrap: anywhere; }
  .cell-meaning, .cell-colloc, .pword, .drill-list { line-height: 1.65; }
  .btn-start, .btn-drill, .tab { min-height: 36px; }
  button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
</style>
</head>
<body>

<header class="top">
  <div class="brand">
    <span class="logo">Aa</span>
    <div class="brand-text">
      <h1>${safeTitle}</h1>
      <p>单词与搭配 · 课堂演示</p>
    </div>
  </div>
  <div class="tabs" id="tabs">
    <button class="tab active" data-tab="words" type="button">词汇概览</button>
    <button class="tab" data-tab="practice" type="button">搭配练习</button>
  </div>
  <div class="top-meta" id="top-meta"></div>
</header>

<section class="view active" id="view-overview">
  <div class="grid" id="grid"></div>
  <div class="practice-list" id="practice-list" style="display:none"></div>
  <div class="overview-foot" id="overview-foot">
    <button class="btn-start" id="btn-start" type="button">从头开始 <span>→</span></button>
  </div>
</section>

<section class="view" id="view-card">
  <button class="card-back" id="btn-card-back" type="button" title="回到词汇概览" aria-label="回到词汇概览"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg></button>
  <div class="zone prev" id="zone-prev" title="上一个"><span class="zone-arrow">‹</span></div>
  <article class="card" id="word-card"></article>
  <div class="zone next" id="zone-next" title="下一个"><span class="zone-arrow">›</span></div>
  <div class="card-foot">
    <div class="progress"><span id="progress-bar"></span></div>
    <span class="progress-text" id="progress-text"></span>
    <button class="btn-drill" id="btn-drill" type="button">去练习 →</button>
  </div>
</section>

<section class="view" id="view-drill">
  <div class="drill-wrap">
    <div class="drill-head">
      <button class="btn-back" id="btn-drill-back" type="button" title="返回上一页" aria-label="返回上一页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg></button>
      <span class="drill-title" id="drill-title"></span>
    </div>
    <div class="drill-word" id="drill-word"></div>
    <div class="drill-list" id="drill-list"></div>
  </div>
</section>

<script>
(function () {
  var WORDS = ${json};
  var WITH_PRACTICE = ${withPractice};

  var state = { view: 'overview', tab: 'words', index: 0, drillFrom: 'card' };

  function el(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 音标可能自带斜杠，统一去掉外侧斜杠后只包一层，避免出现 //kɒrɪdɔː// */
  function ipaLabel(value) {
    var t = String(value == null ? '' : value).trim();
    while (t.charAt(0) === '/' || t.charAt(0) === '[') t = t.slice(1);
    while (t.charAt(t.length - 1) === '/' || t.charAt(t.length - 1) === ']') t = t.slice(0, -1);
    t = t.trim();
    return t ? '/' + esc(t) + '/' : '';
  }

  function showView(name) {
    state.view = name;
    var views = ['overview', 'card', 'drill'];
    for (var i = 0; i < views.length; i += 1) {
      el('view-' + views[i]).classList.toggle('active', views[i] === name);
    }
    el('tabs').style.visibility = name === 'overview' ? 'visible' : 'hidden';
  }

  function collocLines(item) {
    if (!item.collocations || !item.collocations.length) return '';
    var parts = [];
    for (var i = 0; i < item.collocations.length; i += 1) {
      var c = item.collocations[i];
      parts.push(esc(c.p) + (c.m ? '（' + esc(c.m) + '）' : ''));
    }
    return parts.join('；');
  }

  /* ---------------------------- 概览 ---------------------------- */

  function renderGrid() {
    var html = '';
    for (var i = 0; i < WORDS.length; i += 1) {
      var item = WORDS[i];
      html += '<button class="word-cell" type="button" data-index="' + i + '">';
      html += '<span class="cell-top"><span class="cell-order">' + item.order + '</span>';
      html += '<span class="cell-word">' + esc(item.word) + '</span></span>';
      if (item.ipa) html += '<span class="cell-ipa">' + ipaLabel(item.ipa) + '</span>';
      html += '<span class="cell-meaning">' + esc(item.meaning) + '</span>';
      var lines = collocLines(item);
      if (lines) html += '<span class="cell-colloc" title="' + lines + '">' + lines + '</span>';
      if (item.exercises.length) html += '<span class="cell-badge">' + item.exercises.length + ' 道练习</span>';
      html += '</button>';
    }
    el('grid').innerHTML = html || '<p class="empty-tip">没有可演示的词条。</p>';
  }

  function renderPracticeList() {
    var html = '';
    for (var i = 0; i < WORDS.length; i += 1) {
      var item = WORDS[i];
      if (!item.exercises.length) continue;
      html += '<article class="pword" data-word="' + i + '">';
      html += '<header class="pword-head">';
      html += '<span class="pword-word">' + esc(item.word) + '</span>';
      if (item.pos) html += '<span class="pword-pos">' + esc(item.pos) + '</span>';
      html += '<span class="pword-meaning">' + esc(item.meaning) + '</span>';
      var lines = collocLines(item);
      if (lines) html += '<span class="pword-colloc" title="' + lines + '">' + lines + '</span>';
      html += '</header>';
      html += '<div class="qlist">';
      for (var q = 0; q < item.exercises.length; q += 1) {
        html += questionHtml(item, q, i);
      }
      html += '</div></article>';
    }
    el('practice-list').innerHTML =
      html || '<p class="empty-tip">这次选的词都还没有练习题。可以先在单词本「查看练习题」里生成。</p>';
  }

  function questionHtml(item, qIndex, wordIndex) {
    var q = item.exercises[qIndex];
    var isChoice = q.options && q.options.length > 0;
    var html = '<div class="q" id="q-' + wordIndex + '-' + qIndex + '">';
    html += '<div class="q-head">';
    html += '<span class="q-tag' + (isChoice ? ' choice' : '') + '">' + (isChoice ? '选择' : '填空') + '</span>';
    html += '<span class="q-no">Q' + (qIndex + 1) + '</span>';
    if (q.point) html += '<span class="q-point">' + esc(q.point) + '</span>';
    html += '</div>';
    html += '<p class="q-stem">' + esc(q.stem) + '</p>';

    if (isChoice) {
      html += '<div class="q-opts">';
      for (var o = 0; o < q.options.length; o += 1) {
        var right = q.options[o] === q.answer ? '1' : '0';
        html += '<button class="q-opt" type="button" data-correct="' + right + '">' + esc(q.options[o]) + '</button>';
      }
      html += '</div>';
    }

    html += '<div class="q-foot"><button class="btn-ghost js-toggle" type="button">看答案</button>';
    html += '<span class="q-answer hide">答案：' + esc(q.answer) + '</span></div>';
    if (q.explanation) html += '<p class="q-note hide">' + esc(q.explanation) + '</p>';
    html += '</div>';
    return html;
  }

  function renderOverview() {
    var wordsShown = state.tab === 'words';
    el('grid').style.display = wordsShown ? '' : 'none';
    el('practice-list').style.display = wordsShown ? 'none' : 'flex';
    el('overview-foot').style.display = wordsShown ? 'flex' : 'none';
    var tabs = el('tabs').getElementsByTagName('button');
    for (var i = 0; i < tabs.length; i += 1) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === state.tab);
    }
    if (wordsShown) renderGrid();
    else renderPracticeList();
  }

  /* ---------------------------- 单词卡 ---------------------------- */

  function renderCard() {
    var item = WORDS[state.index];
    if (!item) return;
    var html = '';

    // 顶部元信息 → 单词（视觉中心）→ 音标 → 释义 → 固定搭配（靠近释义，不贴底）
    html += '<div class="card-top"><span>第 ' + (state.index + 1) + ' / ' + WORDS.length + ' 词</span>';
    html += '<span class="dot"></span>';
    html += '<span>' + (item.exercises.length ? item.exercises.length + ' 道练习' : '暂无练习') + '</span></div>';

    html += '<p class="card-word">' + esc(item.word) + '</p>';
    if (item.ipa) html += '<p class="card-ipa">' + ipaLabel(item.ipa) + '</p>';
    html += '<div class="card-divider"></div>';
    html += '<p class="card-meaning">';
    if (item.pos) html += '<span class="card-pos">' + esc(item.pos) + '</span>';
    html += esc(item.meaning) + '</p>';

    if (item.collocations && item.collocations.length) {
      html += '<div class="card-colloc"><h3>固定搭配</h3>';
      for (var c = 0; c < item.collocations.length; c += 1) {
        var entry = item.collocations[c];
        html += '<div class="colloc-row"><span class="colloc-pattern">' + esc(entry.p) + '</span>';
        if (entry.m) html += '<span class="colloc-meaning">' + esc(entry.m) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }

    el('word-card').innerHTML = html;

    el('progress-bar').style.width = Math.round(((state.index + 1) / WORDS.length) * 100) + '%';
    el('progress-text').textContent = (state.index + 1) + ' / ' + WORDS.length;

    var drill = el('btn-drill');
    drill.disabled = !item.exercises.length;
    drill.textContent = item.exercises.length ? '去练习 →' : '暂无练习';
  }

  /* ---------------------------- 练习页 ---------------------------- */

  function renderDrill(wordIndex) {
    var item = WORDS[wordIndex];
    if (!item) return;
    var head = '<h2>' + esc(item.word) + '</h2>';
    if (item.ipa) head += '<p>' + ipaLabel(item.ipa) + '</p>';
    head += '<p>' + (item.pos ? esc(item.pos) + ' ' : '') + esc(item.meaning) + '</p>';
    var lines = collocLines(item);
    if (lines) head += '<p class="drill-colloc">' + lines + '</p>';
    el('drill-word').innerHTML = head;

    var html = '';
    for (var q = 0; q < item.exercises.length; q += 1) {
      html += questionHtml(item, q, wordIndex);
    }
    el('drill-list').innerHTML = html || '<p class="empty-tip">这个词暂时没有练习。</p>';
    el('drill-title').textContent =
      state.drillFrom === 'practice' ? '来自练习概览 · 返回可继续看别的词' : '来自单词卡 · 返回可回到卡片';
  }

  /* ---------------------------- 导航 ---------------------------- */

  function openCard(index) {
    if (index < 0) index = 0;
    if (index > WORDS.length - 1) index = WORDS.length - 1;
    state.index = index;
    renderCard();
    showView('card');
    el('view-card').scrollTop = 0;
  }

  function openDrill(wordIndex, from, qIndex) {
    state.index = wordIndex;
    state.drillFrom = from;
    renderDrill(wordIndex);
    showView('drill');
    if (typeof qIndex === 'number' && qIndex >= 0) {
      var target = el('q-' + wordIndex + '-' + qIndex);
      if (target) {
        setTimeout(function () {
          target.scrollIntoView({ block: 'center', behavior: 'smooth' });
          target.style.outline = '2px solid #c6dda4';
          setTimeout(function () { target.style.outline = ''; }, 1600);
        }, 120);
      }
    } else {
      el('view-drill').scrollTop = 0;
    }
  }

  function backFromDrill() {
    if (state.drillFrom === 'practice') {
      state.tab = 'practice';
      renderOverview();
      showView('overview');
      return;
    }
    renderCard();
    showView('card');
  }

  function nextCard() {
    if (state.index >= WORDS.length - 1) return;
    state.index += 1;
    renderCard();
  }

  function prevCard() {
    if (state.index <= 0) return;
    state.index -= 1;
    renderCard();
  }

  /* ---------------------------- 事件 ---------------------------- */

  el('tabs').addEventListener('click', function (event) {
    var button = event.target.closest('.tab');
    if (!button) return;
    state.tab = button.getAttribute('data-tab');
    renderOverview();
  });

  el('grid').addEventListener('click', function (event) {
    var cell = event.target.closest('.word-cell');
    if (!cell) return;
    openCard(Number(cell.getAttribute('data-index')));
  });

  el('btn-start').addEventListener('click', function () {
    openCard(0);
  });

  el('zone-prev').addEventListener('click', prevCard);
  el('zone-next').addEventListener('click', nextCard);

  el('btn-drill').addEventListener('click', function () {
    openDrill(state.index, 'card');
  });

  el('btn-drill-back').addEventListener('click', backFromDrill);

  el('btn-card-back').addEventListener('click', function () {
    showView('overview');
  });

  document.addEventListener('click', function (event) {
    var opt = event.target.closest('.q-opt');
    if (opt) {
      var box = opt.parentNode;
      var buttons = box.getElementsByTagName('button');
      for (var i = 0; i < buttons.length; i += 1) {
        buttons[i].classList.remove('correct', 'wrong');
      }
      var isRight = opt.getAttribute('data-correct') === '1';
      opt.classList.add(isRight ? 'correct' : 'wrong');
      if (!isRight) {
        for (var j = 0; j < buttons.length; j += 1) {
          if (buttons[j].getAttribute('data-correct') === '1') buttons[j].classList.add('correct');
        }
      }
      var card = opt.closest('.q');
      if (card) {
        var answer = card.querySelector('.q-answer');
        var note = card.querySelector('.q-note');
        if (answer) answer.classList.remove('hide');
        if (note) note.classList.remove('hide');
      }
      return;
    }

    var toggle = event.target.closest('.js-toggle');
    if (toggle) {
      var q = toggle.closest('.q');
      if (!q) return;
      var ans = q.querySelector('.q-answer');
      var exp = q.querySelector('.q-note');
      var hidden = ans && ans.classList.contains('hide');
      if (ans) ans.classList.toggle('hide', !hidden);
      if (exp) exp.classList.toggle('hide', !hidden);
      toggle.textContent = hidden ? '收起答案' : '看答案';
      return;
    }

    // 点练习概览里某个词的空白处 → 进入该词的练习页
    var pword = event.target.closest('.pword');
    if (pword && !event.target.closest('.q')) {
      openDrill(Number(pword.getAttribute('data-word')), 'practice');
    }
  });

  // 点题目卡（非按钮区域）也能进该词练习页并定位到这一题
  el('practice-list').addEventListener('click', function (event) {
    var q = event.target.closest('.q');
    if (!q || event.target.closest('button')) return;
    var pword = q.closest('.pword');
    if (!pword) return;
    var wordIndex = Number(pword.getAttribute('data-word'));
    var index = Array.prototype.indexOf.call(q.parentNode.children, q);
    openDrill(wordIndex, 'practice', index);
  });

  document.addEventListener('keydown', function (event) {
    if (state.view === 'card') {
      if (
        event.key === 'ArrowRight' ||
        event.key === 'ArrowDown' ||
        event.key === 'PageDown' ||
        event.key === ' ' ||
        event.key === 'Enter'
      ) {
        event.preventDefault();
        nextCard();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        prevCard();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        renderOverview();
        showView('overview');
      }
      return;
    }
    if (state.view === 'drill' && event.key === 'Escape') {
      event.preventDefault();
      backFromDrill();
    }
  });

  /* ---------------------------- 启动 ---------------------------- */

  el('top-meta').textContent = WORDS.length + ' 词 · ' + WITH_PRACTICE + ' 词有练习';
  renderOverview();
  showView('overview');
})();
</script>
</body>
</html>`;
}
