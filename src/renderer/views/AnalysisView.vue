<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, reactive, ref, watch } from 'vue';
import { BLOCK_TITLES, DIFFICULTY_UI_LABEL, MAX_PASSAGE_CHARS, type ExerciseDifficulty } from '../../shared/constants';
import { payloadSections } from '../../shared/derive';
import { formatDateTime } from '../../shared/format';
import type { ExportFormat, VocabEntry } from '../../shared/types';
import AppIcon from '../components/AppIcon.vue';
import ResultBoard from '../components/result/ResultBoard.vue';
import { currentInput, go, isResultStale, showToast, store } from '../store';
import { desktop } from '../useDesktop';
import { copyToClipboard } from '../utils/copy';
import { addToMyVocab, loadMyVocab } from '../useMyVocab';
import { plain } from '../utils/plain';
import { locateQuoteRanges, locateRanges, type SourceRange } from '../utils/locate';
import { splitParagraphs } from '../utils/paragraphs';
import { SOURCE_LOCATE, type SourceLocateKind } from '../utils/sourceLocate';
import { buildResultText } from '../utils/resultText';

const canceling = ref(false);
const exporting = ref<ExportFormat | ''>('');
/** 文章导入：照片走视觉识别，文件直接读正文 */
const importBusy = ref(false);
const importMenuOpen = ref(false);
/** 编辑区上方的紧凑文件条：读取中 / 成功 / 失败都只占一行 */
const ioBar = ref<{ kind: 'busy' | 'ok' | 'error' | 'ask'; name: string; note: string } | null>(null);
/** 已有正文时，拖入先停下等确认，不直接覆盖 */
const pendingReplace = ref<{ aim: 'photo' | 'file'; paths: string[]; name: string } | null>(null);

/** 改稿与结果分开：有结果时先看结果，点「修改原文」才就地编辑 */
const editMode = ref(false);
/** 专注备课：收起全局导航与页面留白，原文与结果两栏都保留 */
const focusMode = computed(() => store.focus);
/** 顶部「更多」与提示浮层 */
const moreOpen = ref(false);
const noticeOpen = ref<'' | 'issues' | 'trace'>('');

/** 拖入状态：只在编辑区上覆盖提示，布局不移动 */
const dragActive = ref(false);
const dragNames = ref<string[]>([]);
const dragPoint = reactive({ x: 0, y: 0 });
let dragDepth = 0;

const keyStateText = computed(() => {
  if (!store.settings.hasKey) return 'API 未设置';
  return store.settings.keyPersisted ? '密钥已保存' : '密钥仅本次有效';
});

let runToken = 0;
let requestId = '';
let controller: AbortController | null = null;
let ticker: number | undefined;
let unsubscribe: (() => void) | null = null;

const running = computed(() => store.analysis.status === 'generating');
const result = computed(() => store.analysis.result);
const error = computed(() => store.analysis.error);
const preview = computed(() => store.analysis.preview);
const stale = computed(() => isResultStale());
const overLimit = computed(() => store.form.text.length > MAX_PASSAGE_CHARS);

const missingBlocks = computed(() => (result.value?.missing ?? []).map((block) => BLOCK_TITLES[block]));
const issues = computed(() => result.value?.issues ?? []);
/** 生成留档：每一步模型调用的耗时与结论，排障时看这里 */
const trace = computed(() => result.value?.trace ?? []);

/** 没有任何结果时是整幅输入；有结果时左栏可原地改 */
const fullEditor = computed(() => !result.value);
/** 有结果且点了「修改原文」：左栏阅读态换成编辑框，右栏保持上一次结果 */
const inPlaceEdit = computed(() => Boolean(result.value) && editMode.value);

/** 标题取正文首行的前若干字，和设计稿的「文章解析 · Roland Reisley」一致 */
const docTitle = computed(() => {
  const first = store.form.text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  if (!first) return '新文章';
  const cleaned = first.replace(/^[\d.\s、]+/, '').trim();
  if (!cleaned) return '新文章';
  if (cleaned.length <= 60) return cleaned;
  const cut = cleaned.slice(0, 60);
  const space = cut.lastIndexOf(' ');
  return `${space > 30 ? cut.slice(0, space) : cut}…`;
});

/** 状态徽标：等待 / 解析中 / 已解析 / 失败 */
const statusBadge = computed(() => {
  if (running.value) return { text: '解析中', tone: 'busy' };
  if (error.value) return { text: '解析失败', tone: 'bad' };
  if (result.value) return { text: issues.value.length ? '已解析 · 内容待核对' : '已解析', tone: 'ok' };
  return { text: '等待解析', tone: '' };
});

/** 失败类型 → 一句话定位：是没响应，还是返回了但格式不合规 */
const failureKind = computed(() => {
  switch (store.analysis.errorCode) {
    case 'EMPTY':
      return '服务返回成功但没有正文内容';
    case 'FORMAT':
      return '有返回内容，但不是规定的双层 JSON';
    case 'TRUNCATED':
      return '有返回内容，但被长度上限截断';
    case 'TIMEOUT':
      return '在超时时间内没有收到完整响应';
    case 'NETWORK':
    case 'TLS':
      return '没有收到响应（连接失败）';
    case 'HTTP':
      return '服务端拒收了请求参数（模型名、字段或长度）';
    case 'AUTH':
    case 'BALANCE':
    case 'FORBIDDEN':
    case 'MODEL':
    case 'RATE_LIMIT':
      return '服务端拒绝请求（密钥、余额、模型或限流）';
    case 'SERVER':
      return '服务端自身报错';
    case 'VALIDATION':
      return '本地校验未通过';
    default:
      return '';
  }
});

const generateLabel = computed(() => {
  if (!running.value) return result.value ? '重新解析' : '开始解析';
  return canceling.value ? '正在取消…' : '解析中…';
});

const practiceGenerating = computed(() => store.practice.status === 'generating');

function clearPassage() {
  store.form.text = '';
  store.analysis.error = '';
  store.analysis.status = 'idle';
  ioBar.value = null;
}

function validate(): string {
  if (!store.form.text.trim()) return '请先粘贴或导入文章，再开始解析。';
  if (overLimit.value) return '文章超过当前上限 20,000 字符，请缩短后重试。';
  if (!store.settings.hasKey) {
    return '请先到 API 设置中输入并保存密钥，随后返回解析。';
  }
  return '';
}

function stopTicker() {
  if (ticker !== undefined) {
    window.clearInterval(ticker);
    ticker = undefined;
  }
}

function resetPracticeState() {
  store.practice.status = 'idle';
  store.practice.error = '';
  store.practice.errorCode = '';
  store.practice.preview = '';
}

async function generate() {
  if (running.value) return;
  store.analysis.error = '';
  store.analysis.errorCode = '';
  store.analysis.preview = '';
  store.analysis.stage = '';
  store.analysis.stageIndex = 0;
  store.analysis.stageTotal = 0;

  const problem = validate();
  if (problem) {
    store.analysis.error = problem;
    store.analysis.status = 'error';
    return;
  }

  const input = currentInput();
  const token = ++runToken;
  controller = new AbortController();
  requestId = crypto.randomUUID();
  store.analysis.status = 'generating';
  store.analysis.elapsed = 0;
  ticker = window.setInterval(() => {
    store.analysis.elapsed += 1;
  }, 1000);

  try {
    const response = await desktop().analyze({ requestId, input });
    if (token !== runToken) return;

    if (!response.ok) {
      if (response.code === 'CANCELLED') {
        store.analysis.status = 'cancelled';
        return;
      }
      store.analysis.status = 'error';
      store.analysis.error = response.message;
      store.analysis.errorCode = response.code;
      store.analysis.preview = response.preview ?? '';
      return;
    }

    store.analysis.result = response.result;
    // 默认打开篇章分析；该板块缺失时落到第一个有内容的页签，不至于一进来是空页
    const filled = (['discourse', 'questions', 'vocab', 'sentences'] as const).find((key) => {
      const value = response.result[key];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });
    store.resultTab = filled ?? 'discourse';
    store.analysis.status = 'success';
    store.analysis.stage = '';
    resetPracticeState();
    editMode.value = false;
    const missing = response.result.missing?.length;
    showToast(
      missing ? 'info' : 'ok',
      missing
        ? `解析已返回，但有 ${missing} 个板块未通过校验，见结果区提示。`
        : 'AI 解析完成，请核对原文依据与答案。',
    );
  } catch (caught) {
    if (token !== runToken || controller?.signal.aborted) return;
    store.analysis.status = 'error';
    store.analysis.error =
      caught instanceof Error && caught.message
        ? `无法完成解析：${caught.message}`
        : '无法完成解析。请检查桌面进程是否正常，或重新保存 API 设置后重试。';
  } finally {
    if (token === runToken) {
      stopTicker();
      requestId = '';
    }
  }
}

async function generatePractice() {
  const current = result.value;
  if (!current || practiceGenerating.value) return;
  const vocab = current.vocab ?? [];
  const sentences = current.sentences ?? [];
  if (!vocab.length && !sentences.length) {
    showToast('error', '没有可用的词汇或句子，无法出题。请先完成解析。');
    return;
  }

  store.practice.status = 'generating';
  store.practice.error = '';
  store.practice.errorCode = '';
  store.practice.stage = '';

  try {
    const response = await desktop().generatePractice({
      requestId: crypto.randomUUID(),
      input: plain({
        text: current.input.text,
        vocab,
        sentences,
        difficulty: store.practice.difficulty,
      }),
    });
    if (!response.ok) {
      store.practice.status = 'error';
      store.practice.error = response.message;
      store.practice.errorCode = response.code;
      store.practice.preview = response.preview ?? '';
      return;
    }
    store.analysis.result = { ...current, exercise: response.exercise };
    store.practice.status = 'done';
    showToast('ok', `已生成 ${response.exercise.items.length} 道${DIFFICULTY_UI_LABEL[store.practice.difficulty]}练习。`);
  } catch (caught) {
    store.practice.status = 'error';
    store.practice.error =
      caught instanceof Error && caught.message
        ? `练习生成失败：${caught.message}`
        : '练习生成失败，请稍后重试。';
  }
}

/** 从当前结果里删掉勾选的重点词汇（只影响本次结果，不写历史）。 */
function removeVocab(ids: string[]) {
  const current = result.value;
  if (!current || !ids.length) return;
  const drop = new Set(ids);
  const vocab = (current.vocab ?? []).filter((item) => !drop.has(item.id));
  store.analysis.result = { ...current, vocab };
  showToast('info', `已删除 ${ids.length} 个词条，练习目标会同步减少。`);
}

/** 勾选的词条存入「我的词汇」，已存在的只补空字段。 */
async function saveVocab(items: VocabEntry[]) {
  if (!items.length) return;
  const current = result.value;
  const source = current ? `文章解析 · ${current.completedAt.slice(0, 10)}` : '';
  const saved = await addToMyVocab(
    items.map((item) => ({
      term: item.term,
      meaning: item.meaning,
      phonetic: item.phonetic,
      pos: item.pos,
      origin: 'analysis' as const,
    })),
    source,
  );
  if (saved) showToast('ok', `已存入我的词汇 ${saved} 条，可在「单词本 · 我的词汇」查看。`);
}

function changeDifficulty(value: ExerciseDifficulty) {
  store.practice.difficulty = value;
  if (store.practice.status === 'error') {
    store.practice.error = '';
    store.practice.status = 'idle';
  }
}

async function cancel() {
  if (!running.value || canceling.value) return;
  canceling.value = true;
  try {
    if (requestId) {
      const response = await desktop().cancelAnalysis(requestId);
      if (!response.ok) {
        store.analysis.error = response.message;
        return;
      }
    }
    runToken += 1;
    controller?.abort();
    controller = null;
    stopTicker();
    store.analysis.status = 'cancelled';
    showToast('info', '已取消本次请求，文章与上次结果已保留。');
  } catch {
    store.analysis.error = '取消指令未送达，请再次尝试或等待请求超时。';
  } finally {
    canceling.value = false;
  }
}

async function copyAll() {
  if (!result.value) return;
  moreOpen.value = false;
  const ok = await copyToClipboard(buildResultText(result.value));
  showToast(
    ok ? 'ok' : 'error',
    ok ? '全部结果已复制，包含来源与校验提示。' : '复制失败，请手动选择结果文本后按 Ctrl+C。',
  );
}

async function exportAs(format: ExportFormat) {
  const current = result.value;
  if (!current || exporting.value) return;
  exporting.value = format;
  moreOpen.value = false;
  try {
    const response = await desktop().exportLesson(
      plain({
        format,
        sections: payloadSections(current),
        input: current.input,
        model: current.model,
        completedAt: current.completedAt,
        source: current.source,
        isSample: current.isSample,
      }),
    );
    if (!response.ok) {
      showToast('error', response.message);
      return;
    }
    if (response.canceled) {
      showToast('info', '已取消导出。');
      return;
    }
    showToast('ok', `已导出：${response.filePath}`);
  } catch (caught) {
    showToast(
      'error',
      caught instanceof Error && caught.message ? `导出失败：${caught.message}` : '导出失败，请稍后重试。',
    );
  } finally {
    exporting.value = '';
  }
}

/* ---------------------- 原文：分段、定位与高亮 ---------------------- */

/** 原文分段：与结果面板的段号共用一套规则，保证「P2 · 定位原文」对得上 */
const paragraphs = computed(() => splitParagraphs(store.form.text));

const activePara = ref(0);
const editArea = ref<HTMLTextAreaElement | null>(null);
const sourceBody = ref<HTMLElement | null>(null);
const paraEls = new Map<number, HTMLElement>();

function setParaEl(index: number, el: unknown) {
  if (el instanceof HTMLElement) paraEls.set(index, el);
  else paraEls.delete(index);
}

/** 当前高亮的字符区间（词汇/句子悬停定位） */
const highlightRanges = ref<SourceRange[]>([]);

/** 原文内搜索：只做高亮与跳转，不改文章 */
const searchOpen = ref(false);
const sourceQuery = ref('');
const searchField = ref<HTMLInputElement | null>(null);

const searchRanges = computed<SourceRange[]>(() => {
  const needle = sourceQuery.value.trim().toLowerCase();
  if (!needle) return [];
  const text = store.form.text.toLowerCase();
  const out: SourceRange[] = [];
  let from = 0;
  while (out.length < 200) {
    const found = text.indexOf(needle, from);
    if (found < 0) break;
    out.push({ start: found, end: found + needle.length });
    from = found + needle.length;
  }
  return out;
});

/** 定位高亮与搜索高亮合并，避免同一段被切碎 */
const activeRanges = computed<SourceRange[]>(() => {
  const all = [...highlightRanges.value, ...searchRanges.value].sort((a, b) => a.start - b.start);
  const merged: SourceRange[] = [];
  for (const range of all) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
});

interface Chunk {
  text: string;
  hit: boolean;
}

function chunksOf(para: Paragraph): Chunk[] {
  const ranges = activeRanges.value
    .filter((range) => range.end > para.start && range.start < para.end)
    .map((range) => ({
      start: Math.max(range.start, para.start) - para.start,
      end: Math.min(range.end, para.end) - para.start,
    }));
  if (!ranges.length) return [{ text: para.text, hit: false }];
  const chunks: Chunk[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) chunks.push({ text: para.text.slice(cursor, range.start), hit: false });
    chunks.push({ text: para.text.slice(range.start, range.end), hit: true });
    cursor = range.end;
  }
  if (cursor < para.text.length) chunks.push({ text: para.text.slice(cursor), hit: false });
  return chunks;
}

/** 滚到某个字符区间所在的段落，并让该段亮一下 */
function scrollToOffset(offset: number) {
  const target = paragraphs.value.find((para) => offset >= para.start && offset < para.end);
  if (!target) return;
  activePara.value = target.index;
  const el = paraEls.get(target.index);
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/** 点段签：跳到该段 */
function jumpTo(index: number) {
  activePara.value = index;
  paraEls.get(index)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** 搜索：回车跳到下一处 */
function searchNext() {
  const ranges = searchRanges.value;
  if (!ranges.length) return;
  const anchor = sourceBody.value ? sourceBody.value.scrollTop : 0;
  const next = ranges.find((range) => {
    const para = paragraphs.value.find((item) => range.start >= item.start && range.start < item.end);
    const el = para ? paraEls.get(para.index) : null;
    return el ? el.offsetTop > anchor + 8 : false;
  });
  scrollToOffset((next ?? ranges[0]).start);
}

/** 结果面板悬停词汇/长难句时调用：算出全部命中区间并跳过去 */
function locateInArticle(text: string, kind: SourceLocateKind) {
  const source = store.form.text;
  // 正文改过之后，旧结果的定位位置已经不可信，先不跳
  if (!source || stale.value) return;
  const ranges = kind === 'quote' ? locateQuoteRanges(source, text) : locateRanges(source, text);
  highlightRanges.value = ranges;
  if (!ranges.length) return;
  void nextTick(() => scrollToOffset(ranges[0].start));
}

provide(SOURCE_LOCATE, locateInArticle);

// 文章被改动后旧的高亮位置就失效了
watch(
  () => store.form.text,
  () => {
    if (highlightRanges.value.length) highlightRanges.value = [];
    activePara.value = 1;
  },
);

function onImportMenuClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (!target?.closest('.upload-wrap')) importMenuOpen.value = false;
  if (!target?.closest('.more-wrap')) moreOpen.value = false;
}

const DROP_DOCS = ['docx', 'txt', 'md', 'markdown', 'csv'];
const DROP_IMAGES = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

function requestIdFor(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 统一的导入执行：工具栏选择和拖入只是参数来源不同 */
async function runImport(payload: { aim: 'photo' | 'file'; paths?: string[] }, displayName: string) {
  if (importBusy.value || running.value) return;
  ioBar.value = { kind: 'busy', name: displayName, note: '正在读取文件…' };
  importBusy.value = true;
  try {
    const response = await desktop().importArticle({ requestId: requestIdFor('article'), ...payload });
    if (!response.ok) {
      ioBar.value = { kind: 'error', name: displayName, note: response.message };
      return;
    }
    if (response.canceled) {
      ioBar.value = null;
      return;
    }
    store.form.text = response.text;
    editMode.value = true;
    store.focus = false;
    const source = response.sourceLabel || displayName;
    const how = response.via === 'vision' ? `已识别 ${response.imageCount} 张照片` : '已读入正文';
    ioBar.value = {
      kind: 'ok',
      name: source,
      note: `${how} · 共 ${response.text.length.toLocaleString('zh-CN')} 字符，核对后即可开始解析`,
    };
    if (response.text.length >= MAX_PASSAGE_CHARS) {
      showToast('info', '内容已达 20,000 字上限，请检查末尾是否被截断。');
    }
  } catch (caught) {
    ioBar.value = {
      kind: 'error',
      name: displayName,
      note: caught instanceof Error ? caught.message : '导入失败，请重试。',
    };
  } finally {
    importBusy.value = false;
  }
}

async function importArticle(aim: 'photo' | 'file') {
  importMenuOpen.value = false;
  await runImport({ aim }, aim === 'photo' ? '照片 / 截图' : 'Word / 文本文件');
}

/* ------------------------- 拖入上传 ------------------------- */

function hasFileType(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return Boolean(types && Array.from(types).includes('Files'));
}

function dragoverNames(event: DragEvent): string[] {
  const list = event.dataTransfer?.files;
  return list && list.length ? Array.from(list).map((file) => file.name) : [];
}

function onDragEnter(event: DragEvent) {
  if (!hasFileType(event) || running.value || importBusy.value) return;
  event.preventDefault();
  dragDepth += 1;
  dragActive.value = true;
  dragNames.value = dragoverNames(event);
}

function onDragOver(event: DragEvent) {
  if (!hasFileType(event) || running.value || importBusy.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  dragPoint.x = event.clientX;
  dragPoint.y = event.clientY;
  const names = dragoverNames(event);
  if (names.length) dragNames.value = names;
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) {
    dragActive.value = false;
    dragNames.value = [];
  }
}

async function onDrop(event: DragEvent) {
  event.preventDefault();
  dragDepth = 0;
  dragActive.value = false;
  dragNames.value = [];
  if (running.value || importBusy.value) return;

  const files = Array.from(event.dataTransfer?.files ?? []);
  if (!files.length) return;
  const accepted = files.filter((file) => {
    const ext = extensionOf(file.name);
    return DROP_DOCS.includes(ext) || DROP_IMAGES.includes(ext);
  });
  if (!accepted.length) {
    ioBar.value = { kind: 'error', name: files[0]?.name ?? '文件', note: '只支持图片、.docx、.txt、.md。' };
    return;
  }
  const ignored = files.length - accepted.length;
  const paths = accepted.map((file) => desktop().pathForFile(file)).filter(Boolean);
  if (!paths.length) {
    showToast('error', '读不到文件路径，请改用「导入文件」按钮选择。');
    return;
  }
  if (ignored) showToast('info', `已忽略 ${ignored} 个不支持的文件。`);

  const allImages = accepted.every((file) => DROP_IMAGES.includes(extensionOf(file.name)));
  const name =
    accepted.length > 1 ? `${accepted[0].name} 等 ${accepted.length} 个文件` : accepted[0].name;
  const aim: 'photo' | 'file' = allImages ? 'photo' : 'file';
  if (store.form.text.trim() && !editMode.value) {
    // 正在看结果时拖入：先切回编辑区，再询问是否替换
    editMode.value = true;
  }
  if (store.form.text.trim()) {
    pendingReplace.value = { aim, paths, name };
    ioBar.value = { kind: 'ask', name, note: '编辑区已有正文，导入会替换掉它。' };
    return;
  }
  await runImport({ aim, paths }, name);
}

function confirmReplace() {
  const pending = pendingReplace.value;
  pendingReplace.value = null;
  if (!pending) return;
  void runImport({ aim: pending.aim, paths: pending.paths }, pending.name);
}

function cancelReplace() {
  pendingReplace.value = null;
  ioBar.value = null;
}

/** 兜底：拖到编辑区以外的地方也不让 Electron 直接打开文件。 */
function preventNativeDrop(event: DragEvent): void {
  if (hasFileType(event)) event.preventDefault();
}

function onKeydown(event: KeyboardEvent) {
  if (store.view !== 'analysis') return;
  if (event.key === 'Escape' && running.value) {
    event.preventDefault();
    void cancel();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    void generate();
  }
}

/** 点「修改原文」：左栏就地变成编辑框，结果与当前题号都保留 */
function startEdit() {
  editMode.value = true;
  noticeOpen.value = '';
  moreOpen.value = false;
  // 光标落到当前看到的那一段，改错字时不用重新找
  void nextTick(() => {
    const area = editArea.value;
    if (!area) return;
    const para = paragraphs.value.find((item) => item.index === activePara.value);
    area.focus();
    if (para) area.setSelectionRange(para.start, para.end);
  });
}

function backToResult() {
  if (!result.value) return;
  editMode.value = false;
}

function toggleFocus() {
  store.focus = !store.focus;
}

/* ------------------------- 左右栏拖动 ------------------------- */

/** 左栏宽度：设计稿约 372px，可拖动，位置记住 */
const SRC_MIN = 268;
const RESULT_MIN = 420;
const srcWidth = ref(440);
const splitting = ref(false);
const bodyEl = ref<HTMLElement | null>(null);

function startSplit(event: MouseEvent) {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = srcWidth.value;
  const total = bodyEl.value?.clientWidth ?? 0;
  const max = total ? Math.max(SRC_MIN, total - RESULT_MIN) : 760;
  splitting.value = true;
  document.body.classList.add('an-resizing');
  const move = (ev: MouseEvent) => {
    srcWidth.value = Math.round(Math.min(Math.max(startWidth + ev.clientX - startX, SRC_MIN), max));
  };
  const up = () => {
    splitting.value = false;
    document.body.classList.remove('an-resizing');
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    try {
      window.localStorage.setItem('ete:src-width', String(srcWidth.value));
    } catch {
      /* 本地存储不可用时只影响记忆宽度 */
    }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

function restoreWidth() {
  try {
    const saved = Number(window.localStorage.getItem('ete:src-width'));
    if (Number.isFinite(saved) && saved >= SRC_MIN) srcWidth.value = saved;
  } catch {
    /* 忽略 */
  }
}

function openSearch() {
  searchOpen.value = true;
  void nextTick(() => searchField.value?.focus());
}

function closeSearch() {
  searchOpen.value = false;
  sourceQuery.value = '';
}

watch(sourceQuery, () => {
  if (sourceQuery.value.trim()) void nextTick(searchNext);
});

onMounted(() => {
  restoreWidth();
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('click', onImportMenuClick);
  // 拖到编辑区以外的地方也不能让 Electron 直接打开文件
  window.addEventListener('dragover', preventNativeDrop);
  window.addEventListener('drop', preventNativeDrop);
  if (result.value) editMode.value = false;
  unsubscribe = desktop().onAnalyzeProgress((progress) => {
    if (progress.phase === 'exercise') {
      store.practice.stage = progress.text;
      return;
    }
    store.analysis.stage = progress.text;
    store.analysis.stageIndex = progress.index ?? 0;
    store.analysis.stageTotal = progress.total ?? 0;
  });
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('click', onImportMenuClick);
  window.removeEventListener('dragover', preventNativeDrop);
  window.removeEventListener('drop', preventNativeDrop);
  stopTicker();
  controller?.abort();
  unsubscribe?.();
  unsubscribe = null;
});
</script>

<template>
  <div class="page analysis-page">
    <header class="an-head" :class="result ? 'card' : 'bare'">
      <div class="an-head-main">
        <h1 class="an-title">文章解析</h1>
        <template v-if="result">
          <span class="an-title-dot" aria-hidden="true">·</span>
          <span class="an-doc" :title="docTitle">{{ docTitle }}</span>
          <span class="an-badge" :class="statusBadge.tone">{{ statusBadge.text }}</span>
        </template>
      </div>

      <div class="an-head-actions">
        <template v-if="result && !running">
          <button v-if="!inPlaceEdit" class="btn btn-ghost btn-sm icon-text" type="button" @click="startEdit">
            <AppIcon name="edit" :size="14" />
            修改原文
          </button>
          <button v-else class="btn btn-ghost btn-sm icon-text" type="button" @click="backToResult">
            <AppIcon name="check" :size="14" />
            完成修改
          </button>
          <button class="btn btn-ghost btn-sm icon-text" type="button" @click="generate">
            <AppIcon name="refresh" :size="14" />
            重新解析
          </button>
          <button
            v-if="!inPlaceEdit"
            class="btn btn-primary btn-sm icon-text"
            type="button"
            :title="focusMode ? '还原导航与页面留白' : '收起全局导航，把高度还给原文与结果'"
            @click="toggleFocus"
          >
            <AppIcon :name="focusMode ? 'collapse' : 'expand'" :size="14" />
            {{ focusMode ? '退出专注' : '专注备课' }}
          </button>
          <div v-if="!inPlaceEdit" class="more-wrap">
            <button
              class="btn btn-ghost btn-sm icon-text"
              type="button"
              :aria-expanded="moreOpen"
              aria-haspopup="menu"
              @click="moreOpen = !moreOpen"
            >
              更多
              <AppIcon name="chevron-down" :size="12" />
            </button>
            <div v-if="moreOpen" class="menu-pop" role="menu">
              <button type="button" role="menuitem" :disabled="Boolean(exporting)" @click="exportAs('docx')">
                <AppIcon name="word" :size="14" />{{ exporting === 'docx' ? '导出中…' : '导出 Word' }}
              </button>
              <button type="button" role="menuitem" :disabled="Boolean(exporting)" @click="exportAs('md')">
                <AppIcon name="markdown" :size="14" />导出 Markdown
              </button>
              <button type="button" role="menuitem" @click="copyAll">
                <AppIcon name="copy" :size="14" />复制全部结果
              </button>
              <button
                v-if="issues.length"
                type="button"
                role="menuitem"
                @click="noticeOpen = 'issues'; moreOpen = false"
              >
                <AppIcon name="info" :size="14" />校验提示（{{ issues.length }}）
              </button>
              <button
                v-if="trace.length"
                type="button"
                role="menuitem"
                @click="noticeOpen = 'trace'; moreOpen = false"
              >
                <AppIcon name="refresh" :size="14" />生成过程（{{ trace.length }} 步）
              </button>
            </div>
          </div>
        </template>

        <template v-else-if="running">
          <span class="an-timer" role="status" aria-live="polite">
            <AppIcon name="refresh" :size="13" />
            <span class="an-timer-label">已用</span>
            <span class="an-timer-num">{{ store.analysis.elapsed }} 秒</span>
          </span>
          <button class="btn btn-ghost btn-sm" type="button" :disabled="canceling" @click="cancel">
            取消
          </button>
        </template>
      </div>
    </header>

    <!-- 未生成：整幅宽度的输入区 -->
    <section v-if="fullEditor" class="an-input card" :aria-busy="running">
      <div class="an-input-head">
        <span class="an-input-title">文章内容</span>
        <span class="v-sep" aria-hidden="true"></span>
        <div class="upload-wrap">
          <button
            type="button"
            class="btn btn-ghost btn-sm icon-text"
            :disabled="importBusy || running"
            :aria-expanded="importMenuOpen"
            aria-haspopup="menu"
            title="导入文章：照片识别或 Word / 文本文件，也可以直接把文件拖进编辑区"
            @click="importMenuOpen = !importMenuOpen"
          >
            <AppIcon name="paperclip" :size="15" />
            {{ importBusy ? '读取中…' : '导入文件' }}
            <AppIcon name="chevron-down" :size="12" />
          </button>
          <div v-if="importMenuOpen && !importBusy" class="upload-menu" role="menu">
            <button type="button" role="menuitem" @click="importArticle('photo')">
              <b>照片 / 截图</b>
              <span>视觉模型整篇 OCR，正文与题目一起出来</span>
            </button>
            <button type="button" role="menuitem" @click="importArticle('file')">
              <b>Word / 文本文件</b>
              <span>.docx .txt .md，直接读正文</span>
            </button>
          </div>
        </div>
        <span class="v-sep" aria-hidden="true"></span>
        <button
          class="btn btn-ghost btn-sm icon-text"
          type="button"
          :disabled="running || !store.form.text"
          title="清空编辑区（不会动历史记录）"
          @click="clearPassage"
        >
          <AppIcon name="trash" :size="15" />
          清空
        </button>
        <span class="spacer"></span>
        <button type="button" class="conn-pill" title="打开 API 设置" @click="go('settings')">
          <span class="dot" :class="{ on: store.settings.hasKey }" aria-hidden="true"></span>
          {{ keyStateText }}
        </button>
      </div>

      <div class="an-input-body">
        <div class="an-counter" :class="{ over: overLimit }">
          {{ store.form.text.length.toLocaleString('zh-CN') }} / 20,000
        </div>
        <div
          class="source-editor"
          :class="{ 'is-drop': dragActive }"
          @dragenter="onDragEnter"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <textarea
            v-model="store.form.text"
            class="textarea source-input"
            :disabled="running"
            :aria-invalid="store.analysis.errorCode === 'VALIDATION' || overLimit"
            placeholder="粘贴英语文章及阅读理解题目…&#10;可将文件拖入此处"
            spellcheck="false"
          ></textarea>
          <div v-if="dragActive" class="drop-veil">
            <div class="drop-card">
              <span class="drop-icon" aria-hidden="true"><AppIcon name="file" :size="30" :stroke="1.4" /></span>
              <strong>松开以导入文件</strong>
              <span>支持图片、.docx、.txt、.md</span>
            </div>
          </div>
        </div>

        <div v-if="ioBar" class="io-bar" :class="ioBar.kind" role="status">
          <span class="io-dot" aria-hidden="true"></span>
          <b class="io-name">{{ ioBar.name }}</b>
          <span class="io-note">{{ ioBar.note }}</span>
          <template v-if="ioBar.kind === 'ask'">
            <button class="btn btn-ghost btn-sm" type="button" @click="cancelReplace">取消</button>
            <button class="btn btn-primary btn-sm" type="button" @click="confirmReplace">替换并导入</button>
          </template>
          <button
            v-else-if="ioBar.kind !== 'busy'"
            class="io-close"
            type="button"
            aria-label="收起文件提示"
            @click="ioBar = null"
          >
            <AppIcon name="close" :size="12" />
          </button>
        </div>

        <div v-if="error" class="alert error alert-stack" role="alert">
          <span aria-hidden="true">!</span>
          <span>
            {{ error }}
            <em v-if="failureKind" class="failure-kind">判定：{{ failureKind }}</em>
          </span>
        </div>

        <pre v-if="preview && !result" class="preview-box" aria-label="模型原文">{{ preview }}</pre>
      </div>

      <div class="an-input-foot">
        <span class="an-formats">
          <AppIcon name="image" :size="14" />
          支持格式：<b>图片</b> · <b>.docx</b> · <b>.txt</b> · <b>.md</b>
        </span>
        <span class="spacer"></span>
        <button
          class="btn btn-primary an-run"
          type="button"
          :disabled="running || !store.form.text.trim()"
          @click="generate"
        >
          <AppIcon v-if="!running" name="play" :size="12" />
          {{ running ? '解析中…' : '开始解析' }}
        </button>
        <span v-if="!running" class="an-kbd">Ctrl + Enter</span>
      </div>
    </section>

    <!-- 已生成：左原文 + 右结果，中间可拖动 -->
    <div v-else ref="bodyEl" class="an-body" :style="{ '--src-w': `${srcWidth}px` }">
      <aside class="an-source card" aria-label="原文">
        <div class="an-source-head">
          <h2>{{ inPlaceEdit ? '编辑原文' : '原文' }}</h2>
          <div class="an-source-tools">
            <template v-if="inPlaceEdit">
              <span class="an-edit-tag">编辑中</span>
            </template>
            <template v-else>
              <div v-if="searchOpen" class="an-search">
                <AppIcon name="search" :size="14" />
                <input
                  ref="searchField"
                  v-model="sourceQuery"
                  type="text"
                  placeholder="在原文中查找"
                  @keydown.enter.prevent="searchNext"
                  @keydown.esc="closeSearch"
                />
                <span class="an-search-count">{{ searchRanges.length }}</span>
                <button type="button" aria-label="关闭查找" @click="closeSearch">
                  <AppIcon name="close" :size="12" />
                </button>
              </div>
              <button
                v-else
                class="icon-btn"
                type="button"
                aria-label="在原文中查找"
                title="在原文中查找"
                @click="openSearch"
              >
                <AppIcon name="search" :size="16" />
              </button>
            </template>
          </div>
        </div>

        <div v-if="!inPlaceEdit" class="an-chips" role="tablist" aria-label="段落">
          <button
            v-for="para in paragraphs"
            :key="para.index"
            type="button"
            role="tab"
            class="an-chip"
            :class="{ active: activePara === para.index }"
            :aria-selected="activePara === para.index"
            @click="jumpTo(para.index)"
          >
            {{ para.label }}
          </button>
        </div>

        <textarea
          v-if="inPlaceEdit"
          ref="editArea"
          v-model="store.form.text"
          class="an-edit"
          spellcheck="false"
          aria-label="编辑原文"
        ></textarea>

        <div v-else ref="sourceBody" class="an-source-body">
          <article
            v-for="para in paragraphs"
            :key="para.index"
            :ref="(el) => setParaEl(para.index, el)"
            class="an-para"
            :class="{ 'is-active': activePara === para.index }"
            @click="activePara = para.index"
          >
            <span class="an-para-label">{{ para.label }}</span>
            <p class="an-para-text">
              <template v-for="(chunk, i) in chunksOf(para)" :key="i">
                <mark v-if="chunk.hit">{{ chunk.text }}</mark>
                <template v-else>{{ chunk.text }}</template>
              </template>
            </p>
          </article>
        </div>

        <div v-if="inPlaceEdit" class="an-edit-foot">
          <span class="an-counter-inline">{{ store.form.text.length.toLocaleString('zh-CN') }} 字符</span>
          <span class="spacer"></span>
          <button
            class="btn btn-ghost btn-sm icon-text"
            type="button"
            :disabled="running || !store.form.text"
            title="清空当前输入内容（不会动历史记录）"
            @click="clearPassage"
          >
            <AppIcon name="trash" :size="14" />
            清空内容
          </button>
          <button class="btn btn-ghost btn-sm" type="button" @click="backToResult">返回结果</button>
          <button class="btn btn-primary btn-sm" type="button" @click="generate">重新解析</button>
        </div>
      </aside>

      <div
        class="an-split"
        :class="{ dragging: splitting }"
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整原文与结果的宽度"
        @mousedown="startSplit"
      >
        <span class="an-split-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>

      <section class="an-result card" aria-label="解析结果">
        <div v-if="stale" class="an-stale">
          原文已修改，结果待更新
          <button class="link-btn" type="button" @click="generate">重新解析</button>
        </div>
        <ResultBoard
          :payload="result"
          :missing="result.missing"
          :interactive-practice="true"
          :difficulty="store.practice.difficulty"
          :practice-status="store.practice.status"
          :practice-error="store.practice.error"
          :practice-stage="store.practice.stage"
          :source="result.input.text"
          :vocab-editable="true"
          @remove-vocab="removeVocab"
          @save-vocab="saveVocab"
          @update:difficulty="changeDifficulty"
          @generate="generatePractice"
        />
      </section>
    </div>

    <!-- 校验提示 / 生成过程：从「更多」里打开，浮在结果上 -->
    <Teleport to="body">
      <div v-if="noticeOpen" class="notice-mask" @click.self="noticeOpen = ''">
        <div class="notice-panel" role="dialog" aria-label="解析说明">
          <header class="notice-head">
            <h3>{{ noticeOpen === 'issues' ? `校验提示 ${issues.length} 条` : `生成过程 ${trace.length} 步` }}</h3>
            <button class="icon-btn" type="button" aria-label="关闭" @click="noticeOpen = ''">
              <AppIcon name="close" :size="16" />
            </button>
          </header>
          <div class="notice-body">
            <ul v-if="noticeOpen === 'issues'">
              <li v-for="issue in issues" :key="issue">{{ issue }}</li>
            </ul>
            <ul v-else>
              <li v-for="(step, index) in trace" :key="`${step.label}-${index}`" :class="{ bad: !step.ok }">
                <span class="trace-name">{{ step.label }}</span>
                <span class="trace-cost">{{ (step.ms / 1000).toFixed(1) }}s · {{ step.chars }} 字</span>
                <span class="trace-note">{{ step.note }}</span>
              </li>
            </ul>
          </div>
          <footer class="notice-foot">
            <span>模型 {{ result?.model }}</span>
            <span>完成 {{ result ? formatDateTime(result.completedAt) : '' }}</span>
            <span v-if="missingBlocks.length" class="notice-miss">缺 {{ missingBlocks.join('、') }}</span>
          </footer>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="dragActive && dragNames.length"
        class="drop-pill"
        :style="{ left: `${dragPoint.x + 14}px`, top: `${dragPoint.y + 12}px` }"
      >
        <AppIcon name="file" :size="13" />
        {{ dragNames[0] }}
        <span v-if="dragNames.length > 1" class="drop-pill-more">等 {{ dragNames.length }} 个</span>
      </div>
    </Teleport>
  </div>
</template>
