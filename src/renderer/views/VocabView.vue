<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import {
  findBook,
  findUnit,
  MARK_LEGEND,
  unitTitle,
  VOCAB_BOOKS,
  VOCAB_SOURCE,
  VOCAB_TOTAL,
  type VocabEntry,
  type VocabExercise,
  type VocabUnit,
} from '../data/vocab';
import { showToast, store } from '../store';
import { desktop } from '../useDesktop';
import { loadMyVocab, removeMyVocab, updateMyVocab, addToMyVocab } from '../useMyVocab';
import type {
  CollocationAim,
  DemoExercise,
  DemoItem,
  MyVocabEntry,
  VocabPracticeItem,
  WordSheetMode,
} from '../../shared/types';
import CollocCell from '../components/vocab/CollocCell.vue';
import WordDemo from '../components/vocab/WordDemo.vue';
import PracticeBoard from '../components/vocab/PracticeBoard.vue';
import BulkBar from '../components/vocab/BulkBar.vue';
import WordSheetMenu from '../components/vocab/WordSheetMenu.vue';
import type { PracticeRow } from '../components/vocab/practiceRow';

type TabKey = 'textbook' | 'mine';

const tab = ref<TabKey>('textbook');
const bookId = ref(VOCAB_BOOKS[0]?.id ?? '');
const unitNumber = ref(VOCAB_BOOKS[0]?.units[0]?.unitNumber ?? 1);

const book = computed(() => findBook(bookId.value));
const units = computed(() => book.value?.units ?? []);
const unit = computed<VocabUnit | undefined>(
  () => findUnit(bookId.value, unitNumber.value) ?? units.value[0],
);
const entries = computed(() => unit.value?.entries ?? []);

/** 换册次时自动落到该册第一单元，避免出现"必修二 / Unit 9"这类空组合。 */
watch(bookId, () => {
  unitNumber.value = units.value[0]?.unitNumber ?? 1;
});

/* --------------------------- 检索与范围 --------------------------- */

/** 当前单元 / 当前册次 / 全部册次 */
type SearchScope = 'unit' | 'book' | 'all';
const keyword = ref('');
const searchScope = ref<SearchScope>('unit');

/** 跨单元检索结果：带上教材归属，点开前就知道这个词来自哪 */
interface SearchHit {
  key: string;
  bookId: string;
  bookShort: string;
  unitNumber: number;
  unitLabel: string;
  entry: VocabEntry;
}

const scopeLabel = computed(() => {
  if (searchScope.value === 'unit') return '当前单元';
  if (searchScope.value === 'book') return book.value?.short ?? '当前册次';
  return '全部册次';
});

/** 跨单元检索时把整套教材摊平，只构建一次 */
const flatIndex = computed<SearchHit[]>(() => {
  const list: SearchHit[] = [];
  const books =
    searchScope.value === 'all'
      ? VOCAB_BOOKS
      : VOCAB_BOOKS.filter((item) => item.id === bookId.value);
  for (const item of books) {
    for (const unitItem of item.units) {
      for (const entry of unitItem.entries) {
        list.push({
          key: `${item.id}-${unitItem.unitNumber}-${entry.order}`,
          bookId: item.id,
          bookShort: item.short,
          unitNumber: unitItem.unitNumber,
          unitLabel: unitTitle(unitItem),
          entry,
        });
      }
    }
  }
  return list;
});

function matches(entry: VocabEntry, text: string): boolean {
  const haystack = [entry.word, entry.meaning, entry.ipa, ...entry.collocations.map((item) => item.pattern)]
    .join(' ')
    .toLowerCase();
  return haystack.includes(text);
}

const crossSearch = computed(() => searchScope.value !== 'unit' && Boolean(keyword.value.trim()));

const searchHits = computed<SearchHit[]>(() => {
  const text = keyword.value.trim().toLowerCase();
  if (!crossSearch.value || !text) return [];
  return flatIndex.value.filter((hit) => matches(hit.entry, text)).slice(0, 300);
});

/** 单元内检索：只过滤表格，不动单元词表本身 */
const visibleEntries = computed<VocabEntry[]>(() => {
  const text = keyword.value.trim().toLowerCase();
  if (crossSearch.value || !text) return entries.value;
  return entries.value.filter((entry) => matches(entry, text));
});

/** 命中片段高亮：把文本按关键词切成「普通 / 命中」小段 */
function splitHit(text: string): Array<{ text: string; hit: boolean }> {
  const needle = keyword.value.trim();
  if (!needle || !text) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  const parts: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const found = lower.indexOf(target, cursor);
    if (found < 0) {
      parts.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (found > cursor) parts.push({ text: text.slice(cursor, found), hit: false });
    parts.push({ text: text.slice(found, found + target.length), hit: true });
    cursor = found + target.length;
  }
  return parts;
}

function hitCollocation(hit: SearchHit): string {
  return hit.entry.collocations.map((item) => item.pattern).join('；');
}

/* ---------------------------- 固定搭配 ---------------------------- */

/** 存盘键：册次 + 单元，如 bx1u3 */
const unitId = computed(() => `${bookId.value}u${unitNumber.value}`);
const unitLabel = computed(
  () => `${book.value?.short ?? ''} · ${unit.value ? unitTitle(unit.value) : ''}`,
);

const collocations = ref<Record<string, string>>({});
/**
 * 练习覆盖：键为教材词条序号（"3"）或我的词汇（"m:<id>"），
 * 值替换内置练习。空数组表示该词没有练习。
 */
const practiceOverrides = ref<Record<string, VocabExercise[]>>({});
const collocationBusy = ref(false);
const menuOpen = ref(false);
/** 最近一次搭配来源：下拉菜单里给对应项打勾（设计稿的选中态） */
const lastSource = ref<'photo' | 'file' | 'paste'>('paste');
const pasteOpen = ref(false);
const pasteText = ref('');

const collocationCount = computed(() => Object.keys(collocations.value).length);

async function loadCollocations() {
  const id = unitId.value;
  try {
    const result = await desktop().listCollocations(id);
    if (result.ok && id === unitId.value) collocations.value = result.map;
  } catch {
    // 读不到就当空表，单元格显示「待补充」
  }
}

/** 练习覆盖：本机改过的题（含 AI 生成）优先于教材内置。 */
async function loadPractice() {
  const id = unitId.value;
  try {
    const result = await desktop().listVocabPractice(id);
    if (result.ok && id === unitId.value) practiceOverrides.value = result.map;
  } catch {
    practiceOverrides.value = {};
  }
}

watch(unitId, () => {
  collocations.value = {};
  practiceOverrides.value = {};
  pasteOpen.value = false;
  pasteText.value = '';
  void loadCollocations();
  void loadPractice();
});

function makeRequestId(): string {
  return `colloc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function openPaste() {
  menuOpen.value = false;
  lastSource.value = 'paste';
  pasteOpen.value = true;
}

function closePaste() {
  pasteOpen.value = false;
  pasteText.value = '';
}

async function extract(aim: CollocationAim) {
  if (collocationBusy.value) return;
  lastSource.value = aim;
  if (aim === 'paste' && !pasteText.value.trim()) {
    showToast('error', '请先粘贴词表内容。');
    return;
  }
  const words = entries.value.map((entry) => ({
    order: entry.order,
    word: entry.word,
    ipa: entry.ipa,
    pos: entry.partOfSpeech,
    meaning: entry.meaning,
  }));
  if (!words.length) return;

  // 识别期间可能切换了单元：结果只写回发起时的那个单元
  const targetUnit = unitId.value;
  menuOpen.value = false;
  collocationBusy.value = true;
  try {
    const result = await desktop().extractCollocations({
      requestId: makeRequestId(),
      aim,
      ...(aim === 'paste' ? { text: pasteText.value } : {}),
      unit: { id: targetUnit, label: unitLabel.value },
      words,
    });
    if (!result.ok) {
      showToast('error', result.message);
      return;
    }
    if (result.canceled) return;
    if (targetUnit !== unitId.value) {
      showToast('info', '识别完成，但你已经切到别的单元；结果已存入发起识别的那个单元。');
      return;
    }

    if (!result.pairs.length) {
      showToast('info', '这次没有识别到可用的搭配，换张更清晰的照片，或直接粘贴文本试试。');
      return;
    }

    const map = { ...collocations.value };
    for (const pair of result.pairs) map[String(pair.order)] = pair.collocation;
    collocations.value = map;
    if (aim === 'paste') {
      pasteOpen.value = false;
      pasteText.value = '';
    }
    const applied = result.applied ?? result.pairs.length;
    showToast(
      'ok',
      applied
        ? `已补全 ${applied} 个固定搭配（${result.via === 'vision' ? '照片' : '文本'}识别 · ${result.model}）。`
        : `识别到 ${result.pairs.length} 个搭配，本单元已有内容保持不动。`,
    );
  } catch (error) {
    showToast('error', error instanceof Error ? error.message : '识别失败，请稍后重试。');
  } finally {
    collocationBusy.value = false;
  }
}

async function saveCollocation(order: number, text: string) {
  const map = { ...collocations.value };
  if (text) map[String(order)] = text;
  else delete map[String(order)];
  collocations.value = map;
  try {
    const result = await desktop().setCollocation({ unitId: unitId.value, order, text });
    if (!result.ok) {
      showToast('error', result.message);
      return;
    }
    collocations.value = result.map;
  } catch {
    showToast('error', '保存搭配失败，请重试。');
  }
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (menuOpen.value && !target?.closest('.upload-wrap')) menuOpen.value = false;
  if (menuFor.value && !target?.closest('.row-more')) menuFor.value = '';
}

/* ------------------------------ 我的词汇 ------------------------------ */

const mineKeyword = ref('');
const selected = ref<string[]>([]);
const draft = reactive({ term: '', phonetic: '', pos: '', meaning: '', collocation: '' });
/** 右侧编辑面板：新增与修改共用一套字段 */
const editorOpen = ref(false);
const editorMode = ref<'create' | 'edit'>('create');
const editorId = ref('');
const editorSnapshot = ref('');
const dupWarning = ref('');
const saving = ref(false);
const termInput = ref<HTMLInputElement | null>(null);
/** 关闭面板时若有未保存内容，先在这里确认，不用系统弹窗 */
const discardAsk = ref(false);
/** 当前展开「⋯」菜单的词条 */
const menuFor = ref('');

const myItems = computed(() => store.myVocab.items);

const filteredMine = computed(() => {
  const text = mineKeyword.value.trim().toLowerCase();
  if (!text) return myItems.value;
  return myItems.value.filter((item) =>
    [item.term, item.meaning, item.collocation, item.pos].join(' ').toLowerCase().includes(text),
  );
});

const allPicked = computed(
  () => filteredMine.value.length > 0 && selected.value.length === filteredMine.value.length,
);

function togglePick(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((item) => item !== id)
    : [...selected.value, id];
}

function togglePickAll() {
  selected.value = allPicked.value ? [] : filteredMine.value.map((item) => item.id);
}

/** 面板里有没有未保存的改动（音标只差首尾斜杠也算改了） */
const draftDirty = computed(() => JSON.stringify({ ...draft }) !== editorSnapshot.value);

function emptyDraft(): typeof draft {
  return { term: '', phonetic: '', pos: '', meaning: '', collocation: '' };
}

function openCreate() {
  editorMode.value = 'create';
  editorId.value = '';
  dupWarning.value = '';
  discardAsk.value = false;
  menuFor.value = '';
  Object.assign(draft, emptyDraft());
  editorSnapshot.value = JSON.stringify({ ...draft });
  editorOpen.value = true;
  void nextTick(() => termInput.value?.focus());
}

function openEdit(item: MyVocabEntry) {
  editorMode.value = 'edit';
  editorId.value = item.id;
  dupWarning.value = '';
  discardAsk.value = false;
  menuFor.value = '';
  Object.assign(draft, {
    term: item.term,
    phonetic: item.phonetic.replace(/^\/+|\/+$/g, ''),
    pos: item.pos,
    meaning: item.meaning,
    collocation: item.collocation,
  });
  editorSnapshot.value = JSON.stringify({ ...draft });
  editorOpen.value = true;
  void nextTick(() => termInput.value?.focus());
}

/** 直接关掉，不再询问 */
function forceCloseEditor() {
  discardAsk.value = false;
  dupWarning.value = '';
  editorOpen.value = false;
  editorId.value = '';
}

/** 有未保存内容时先显示确认条 */
function closeEditor() {
  if (!editorOpen.value) return;
  if (draftDirty.value) {
    discardAsk.value = true;
    return;
  }
  forceCloseEditor();
}

/** 保存；continueAfter 为真时清空字段、焦点回到单词，方便连续录入 */
async function saveDraft(continueAfter = false) {
  const term = draft.term.trim();
  const meaning = draft.meaning.trim();
  if (!term || !meaning) {
    showToast('error', '单词与释义都要填写。');
    return;
  }
  const dual = myItems.value.find(
    (item) => item.id !== editorId.value && item.term.trim().toLowerCase() === term.toLowerCase(),
  );
  // 重名不静默覆盖：先提示，再点一次才覆盖
  if (dual && !dupWarning.value) {
    dupWarning.value = `「${dual.term}」已经在我的词汇里（${dual.meaning || '无释义'}）。确认覆盖就再点一次保存。`;
    return;
  }

  const payload = {
    term,
    phonetic: draft.phonetic.trim(),
    pos: draft.pos.trim(),
    meaning,
    collocation: draft.collocation.trim(),
  };
  saving.value = true;
  let ok = false;
  try {
    if (editorMode.value === 'create' && !dual) {
      ok = Boolean(await addToMyVocab([{ ...payload, origin: 'manual' }]));
    } else {
      ok = await updateMyVocab(dual ? dual.id : editorId.value, payload);
    }
  } finally {
    saving.value = false;
  }
  if (!ok) return;

  if (continueAfter) {
    Object.assign(draft, emptyDraft());
    editorSnapshot.value = JSON.stringify({ ...draft });
    editorMode.value = 'create';
    editorId.value = '';
    dupWarning.value = '';
    showToast('ok', `已保存「${term}」，可以继续录入。`);
    void nextTick(() => termInput.value?.focus());
    return;
  }
  editorOpen.value = false;
  editorId.value = '';
  dupWarning.value = '';
  showToast('ok', dual ? '已覆盖原有词条。' : '已保存词条。');
}

async function removeSelected() {
  if (!selected.value.length) return;
  const count = selected.value.length;
  const ok = await removeMyVocab([...selected.value]);
  if (ok) {
    selected.value = [];
    showToast('info', `已删除 ${count} 个词条。`);
  }
}

async function removeOne(item: MyVocabEntry) {
  menuFor.value = '';
  const ok = await removeMyVocab([item.id]);
  if (ok) {
    selected.value = selected.value.filter((id) => id !== item.id);
    if (editorId.value === item.id) forceCloseEditor();
    showToast('info', `已删除「${item.term}」。`);
  }
}

/* ------------------------------ 单词演示 ------------------------------ */

const preparing = ref(false);
const demo = ref(false);
const demoItems = ref<DemoItem[]>([]);
const demoTitle = ref('');
/** 生成演示时是否把练习题一起放进去，默认勾选 */
const useExercises = ref(true);
/** 教材用 t:序号，我的词汇用 m:id */
const picked = ref<string[]>([]);

const pickedCount = computed(() => picked.value.length);

function startPrepare() {
  preparing.value = true;
  picked.value =
    tab.value === 'textbook'
      ? entries.value.map((entry) => `t:${entry.order}`)
      : filteredMine.value.map((item) => `m:${item.id}`);
}

function cancelPrepare() {
  preparing.value = false;
  picked.value = [];
}

function togglePickKey(key: string) {
  picked.value = picked.value.includes(key)
    ? picked.value.filter((item) => item !== key)
    : [...picked.value, key];
}

function allKeys(): string[] {
  return tab.value === 'textbook'
    ? entries.value.map((entry) => `t:${entry.order}`)
    : filteredMine.value.map((item) => `m:${item.id}`);
}

const allPrepared = computed(() => pickedCount.value > 0 && pickedCount.value === allKeys().length);

function togglePrepareAll() {
  picked.value = allPrepared.value ? [] : allKeys();
}

// 换页签就退出选词态，否则「已选 N」会带着上一页的勾选数
watch(tab, () => {
  preparing.value = false;
  picked.value = [];
  menuFor.value = '';
});

/**
 * 教材词汇的搭配：优先用识别结果或手动填写（存盘按单元区分），
 * 其次回落到教材词表自带的搭配（7 册 672 个词有）。
 * 留空保存即删除本地覆盖，恢复教材默认。
 */
function collocationText(entry: VocabEntry): string {
  const local = collocations.value[String(entry.order)];
  if (local !== undefined) return local;
  return entry.collocations.map((item) => item.pattern).join('；');
}

/** 单元格里逐条显示的搭配：只有走教材数据时才带中文含义。 */
function collocationEntries(entry: VocabEntry): Array<{ pattern: string; meaning: string }> {
  const local = collocations.value[String(entry.order)];
  if (local !== undefined) {
    return local
      .split(/[；;\n]/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ pattern: text, meaning: '' }));
  }
  return entry.collocations.map((item) => ({ pattern: item.pattern, meaning: item.meaning }));
}

/** 悬浮提示：每条「英文搭配 + 中文释义」一行。 */
function collocationHint(entry: VocabEntry): string {
  const local = collocations.value[String(entry.order)];
  if (local !== undefined) return local ? '点击修改这条搭配（留空恢复教材默认）' : '点击手动填写搭配';
  if (!entry.collocations.length) return '教材未给这个词搭配，可点击补充';
  return entry.collocations
    .map((item) => (item.meaning ? `${item.pattern} ${item.meaning}` : item.pattern))
    .join('\n');
}

/** 词条练习：本机覆盖（编辑/AI 生成）优先，其次教材内置。 */
function localExercises(entry: VocabEntry): VocabPracticeItem[] {
  const override = practiceOverrides.value[String(entry.order)];
  const list = override ?? entry.exercises;
  return list.map((item) => ({
    id: item.id,
    type: item.type,
    point: item.point,
    stem: item.stem,
    answer: item.answer,
    hint: item.hint,
    explanation: item.explanation,
    options: item.options ?? [],
  }));
}

/** 我的词汇目前没有本地练习，AI 生成的练习存在 practiceOverrides 的 m: 前缀键下。 */
function mineExercises(id: string): VocabPracticeItem[] {
  const override = practiceOverrides.value[`m:${id}`];
  return (override ?? []).map((item) => ({
    id: item.id,
    type: item.type,
    point: item.point,
    stem: item.stem,
    answer: item.answer,
    hint: item.hint,
    explanation: item.explanation,
    options: item.options ?? [],
  }));
}

function startDemo() {
  if (!pickedCount.value) return;
  if (tab.value === 'textbook') {
    const chosen = entries.value.filter((entry) => picked.value.includes(`t:${entry.order}`));
    demoItems.value = chosen.map((entry) => ({
      order: entry.order,
      word: entry.word,
      ipa: (entry.ipa ?? '').replace(/^\/+|\/+$/g, ''),
      pos: entry.partOfSpeech ?? '',
      meaning: entry.meaning ?? '',
      collocation: collocationText(entry),
      collocations: entry.collocations.map((item) => ({ pattern: item.pattern, meaning: item.meaning })),
      exercises: useExercises.value ? localExercises(entry) : [],
    }));
    demoTitle.value = `${book.value?.label ?? '教材词汇'} · ${unit.value ? unitTitle(unit.value) : ''}`;
  } else {
    const chosen = filteredMine.value.filter((item) => picked.value.includes(`m:${item.id}`));
    demoItems.value = chosen.map((item, index) => ({
      order: index + 1,
      word: item.term,
      ipa: item.phonetic,
      pos: item.pos,
      meaning: item.meaning,
      collocation: item.collocation,
      collocations: item.collocation
        ? [{ pattern: item.collocation, meaning: '' }]
        : [],
      exercises: useExercises.value ? mineExercises(item.id) : [],
    }));
    demoTitle.value = '我的词汇';
  }
  if (!demoItems.value.length) return;
  demo.value = true;
  preparing.value = false;
  picked.value = [];
}

function closeDemo() {
  demo.value = false;
}

/* ---------------------------- 导出词单 ---------------------------- */

const sheetBusy = ref(false);

const SHEET_LABEL: Record<WordSheetMode, string> = {
  en2zh: '英译汉默写单',
  zh2en: '汉译英默写单',
  both: '词汇单',
};

/** 勾选的词按当前表格顺序导出，三种版式共用一份数据。 */
async function exportSheet(mode: WordSheetMode) {
  if (sheetBusy.value) return;
  const items =
    tab.value === 'textbook'
      ? entries.value
          .filter((entry) => picked.value.includes(`t:${entry.order}`))
          .map((entry) => ({
            word: entry.word,
            ipa: (entry.ipa ?? '').replace(/^\/+|\/+$/g, ''),
            pos: entry.partOfSpeech ?? '',
            meaning: entry.meaning ?? '',
          }))
      : filteredMine.value
          .filter((item) => picked.value.includes(`m:${item.id}`))
          .map((item) => ({
            word: item.term,
            ipa: item.phonetic.replace(/^\/+|\/+$/g, ''),
            pos: item.pos,
            meaning: item.meaning,
          }));
  if (!items.length) return;

  const scope =
    tab.value === 'textbook'
      ? [book.value?.label ?? '教材词汇', unit.value ? unitTitle(unit.value) : ''].filter(Boolean).join(' ')
      : '我的词汇';

  sheetBusy.value = true;
  try {
    const response = await desktop().exportWordSheet({
      mode,
      title: `${scope} · ${SHEET_LABEL[mode]}`,
      items,
    });
    if (!response.ok) {
      showToast('error', response.message);
      return;
    }
    if (response.canceled) return;
    showToast('ok', `已导出 ${items.length} 个词到 ${response.filePath}`);
  } catch {
    showToast('error', '导出失败，请重试。');
  } finally {
    sheetBusy.value = false;
  }
}

/* ---------------------------- 词汇练习 ---------------------------- */

const practiceOpen = ref(false);
const practiceBusy = ref(false);
const practiceStyle = ref<'choice' | 'grammar' | 'mixed' | ''>('');

/** 练习的作用域：教材按单元存，我的词汇统一存在 mine 下 */
const practiceScope = computed(() => (tab.value === 'textbook' ? unitId.value : 'mine'));

const practiceRows = computed<PracticeRow[]>(() => {
  if (tab.value === 'textbook') {
    return entries.value.map((entry) => ({
      key: String(entry.order),
      order: entry.order,
      word: entry.word,
      pos: entry.partOfSpeech,
      meaning: entry.meaning,
      collocation: collocationText(entry),
      collocations: entry.collocations,
      exercises: localExercises(entry),
      builtin: entry.exercises.length > 0,
    }));
  }
  return filteredMine.value.map((item, index) => ({
    key: `m:${item.id}`,
    order: index + 1,
    word: item.term,
    pos: item.pos,
    meaning: item.meaning,
    collocation: item.collocation,
    collocations: item.collocation ? [{ pattern: item.collocation, meaning: '' }] : [],
    exercises: mineExercises(item.id),
    builtin: false,
  }));
});

function openPractice() {
  practiceOpen.value = true;
}

function closePractice() {
  practiceOpen.value = false;
  practiceBusy.value = false;
}

async function savePracticeGroups(
  groups: { key: string; exercises: VocabPracticeItem[] }[],
) {
  const scope = practiceScope.value;
  const result = await desktop().saveVocabPractice({ unitId: scope, groups });
  if (result.ok && scope === practiceScope.value) practiceOverrides.value = result.map;
  return result;
}

async function updateRowPractice(key: string, exercises: VocabPracticeItem[]) {
  try {
    const result = await savePracticeGroups([{ key, exercises }]);
    if (!result.ok) showToast('error', result.message);
  } catch {
    showToast('error', '保存练习失败，请重试。');
  }
}

async function resetRowPractice(key: string) {
  const scope = practiceScope.value;
  try {
    const result = await desktop().resetVocabPractice({ unitId: scope, key });
    if (!result.ok) {
      showToast('error', result.message);
      return;
    }
    if (scope === practiceScope.value) practiceOverrides.value = result.map;
    showToast('success', '已恢复教材默认练习。');
  } catch {
    showToast('error', '恢复默认失败，请重试。');
  }
}

function makePracticeId(): string {
  return `wp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function generatePractice(keys: string[], style: 'choice' | 'grammar' | 'mixed', count = 2) {
  practiceStyle.value = style;
  if (practiceBusy.value) return;
  const rows = practiceRows.value.filter((row) => keys.includes(row.key));
  if (!rows.length) return;

  practiceBusy.value = true;
  try {
    const result = await desktop().generateVocabPractice({
      requestId: makePracticeId(),
      style,
      count: Math.min(4, Math.max(1, count)),
      words: rows.map((row) => ({
        word: row.word,
        meaning: row.meaning,
        pos: row.pos,
        collocations: row.collocations,
      })),
    });
    if (!result.ok) {
      showToast('error', result.message);
      return;
    }

    const byWord = new Map(result.groups.map((group) => [group.word.toLowerCase(), group.exercises]));
    const groups = rows
      .map((row) => ({ key: row.key, exercises: byWord.get(row.word.toLowerCase()) ?? [] }))
      .filter((group) => group.exercises.length);
    if (!groups.length) {
      showToast('error', result.issues[0] ?? '模型没有生成可用的题目，请重试。');
      return;
    }

    const saved = await savePracticeGroups(groups);
    if (!saved.ok) {
      showToast('error', saved.message);
      return;
    }
    showToast('success', `已为 ${groups.length} 个词生成练习。`);
    if (result.issues.length) showToast('info', result.issues[0]);
  } catch (error) {
    showToast('error', error instanceof Error ? error.message : '生成练习失败，请重试。');
  } finally {
    practiceBusy.value = false;
  }
}

onMounted(() => {
  void loadMyVocab();
  void loadCollocations();
  void loadPractice();
  document.addEventListener('click', onDocumentClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
});

const bookTotal = computed(() =>
  (book.value?.units ?? []).reduce((sum, item) => sum + item.entries.length, 0),
);

/** 当前单元实际出现的教材符号，用于只显示相关的图例。 */
const marksInUnit = computed(() => {
  const marks = new Set(entries.value.map((entry) => entry.mark).filter(Boolean));
  return [...marks].map((mark) => ({ mark, label: MARK_LEGEND[mark] ?? '' }));
});
</script>

<template>
  <div class="page vocab-page">
    <header v-if="practiceOpen" class="page-hero">
      <div class="hero-main">
        <h1 class="hero-title">{{ tab === 'textbook' ? '教材词汇' : '我的词汇' }}</h1>
        <nav class="crumbs" aria-label="当前位置">
          <button type="button" @click="closePractice">单词本</button>
          <span class="crumb-sep" aria-hidden="true">/</span>
          <span class="current">词汇练习</span>
        </nav>
      </div>
      <div class="hero-actions">
        <button class="btn btn-ghost btn-sm icon-text" type="button" @click="closePractice">
          <AppIcon name="arrow-left" :size="14" />
          返回单词本
        </button>
      </div>
    </header>
    <section v-if="demo" class="panel vocab-panel demo-panel" aria-label="单词演示">
      <WordDemo :items="demoItems" :title="demoTitle" @close="closeDemo" />
    </section>

    <PracticeBoard
      v-else-if="practiceOpen"
      :title="tab === 'textbook' ? (book?.short ?? '教材词汇') : '我的词汇'"
      :subtitle="tab === 'textbook' ? (unit ? unitTitle(unit) : '选择单元') : '自建词库'"
      :rows="practiceRows"
      :busy="practiceBusy"
      :exam-style="practiceStyle"
      @close="closePractice"
      @update="updateRowPractice"
      @reset="resetRowPractice"
      @generate="generatePractice"
      @pick="practiceStyle = $event"
    />

    <template v-else>
    <header class="vb-head">
      <h1 class="vb-title">单词本</h1>
      
    </header>

    <div class="vocab-tabs-row">
      <div class="vocab-tabs" role="tablist" aria-label="单词本视图">
        <button
          type="button"
          role="tab"
          class="vocab-tab"
          :class="{ active: tab === 'textbook' }"
          :aria-selected="tab === 'textbook'"
          @click="tab = 'textbook'"
        >
          教材词汇
        </button>
        <button
          type="button"
          role="tab"
          class="vocab-tab"
          :class="{ active: tab === 'mine' }"
          :aria-selected="tab === 'mine'"
          @click="tab = 'mine'"
        >
          我的词汇
        </button>
      </div>
      <div v-if="tab === 'textbook'" class="vb-stats">
        <template v-if="crossSearch">
          搜到 <b>{{ searchHits.length }}</b> 条
        </template>
        <template v-else>
          已选 <b>{{ pickedCount }}</b> 词 · 全册 <b>{{ bookTotal }}</b> 词
          <span class="vb-sep" aria-hidden="true">|</span>
          已补 <b>{{ collocationCount }}</b> 条搭配
        </template>
      </div>
    </div>

    <section v-if="tab === 'textbook'" class="panel vocab-panel" aria-labelledby="vocab-heading">
      <h2 id="vocab-heading" class="visually-hidden">教材词汇</h2>

      <div class="vocab-toolbar">
        <label class="vb-field">
          <span class="vb-label">册次</span>
          <select v-model="bookId" class="vb-select">
            <optgroup label="必修">
              <option v-for="item in VOCAB_BOOKS.filter((b) => b.id.startsWith('bx'))" :key="item.id" :value="item.id">
                {{ item.short }}
              </option>
            </optgroup>
            <optgroup label="选择性必修">
              <option v-for="item in VOCAB_BOOKS.filter((b) => b.id.startsWith('xx'))" :key="item.id" :value="item.id">
                {{ item.short }}
              </option>
            </optgroup>
          </select>
        </label>

        <label class="vb-field">
          <span class="vb-label">单元</span>
          <select v-model.number="unitNumber" class="vb-select">
            <option v-for="item in units" :key="item.unitNumber" :value="item.unitNumber">
              {{ unitTitle(item) }}
            </option>
          </select>
        </label>

        <div class="upload-wrap">
          <button
            type="button"
            class="btn btn-ghost btn-sm icon-text colloc-btn"
            :class="{ busy: collocationBusy, open: menuOpen }"
            :disabled="collocationBusy || !entries.length || crossSearch"
            :aria-expanded="menuOpen"
            aria-haspopup="menu"
            :title="crossSearch ? '跨单元检索时请先切回当前单元' : '上传词表照片、Word 或粘贴文本，自动补全固定搭配'"
            @click="menuOpen = !menuOpen"
          >
            <AppIcon :name="collocationBusy ? 'refresh' : 'plus'" :size="14" />
            {{ collocationBusy ? '识别中' : '补搭配' }}
            <AppIcon name="chevron-down" :size="12" class="colloc-caret" />
          </button>
          <div v-if="menuOpen && !collocationBusy" class="src-menu" role="menu">
            <p class="src-menu-head">选择搭配来源</p>
            <button
              type="button"
              role="menuitem"
              :class="{ active: lastSource === 'photo' }"
              @click="extract('photo')"
            >
              <span class="src-icon"><AppIcon name="image" :size="16" /></span>
              <span class="src-text">
                <b>词表照片</b>
                <em>上传教材词汇表照片，识别其中的词与搭配</em>
              </span>
              <AppIcon :name="lastSource === 'photo' ? 'check' : 'chevron-right'" :size="13" class="src-go" />
            </button>
            <button
              type="button"
              role="menuitem"
              :class="{ active: lastSource === 'file' }"
              @click="extract('file')"
            >
              <span class="src-icon"><AppIcon name="word" :size="16" /></span>
              <span class="src-text">
                <b>Word 文档</b>
                <em>上传 Word 文档（.doc / .docx），识别词与搭配</em>
              </span>
              <AppIcon :name="lastSource === 'file' ? 'check' : 'chevron-right'" :size="13" class="src-go" />
            </button>
            <button
              type="button"
              role="menuitem"
              :class="{ active: lastSource === 'paste' }"
              @click="openPaste"
            >
              <span class="src-icon"><AppIcon name="copy" :size="16" /></span>
              <span class="src-text">
                <b>粘贴文本</b>
                <em>粘贴词表文本（如：单词：搭配），识别搭配</em>
              </span>
              <AppIcon :name="lastSource === 'paste' ? 'check' : 'chevron-right'" :size="13" class="src-go" />
            </button>
          </div>
        </div>

        <label class="search-field">
          <AppIcon name="search" :size="15" />
          <input
            v-model="keyword"
            class="input search-input"
            type="search"
            placeholder="单词、释义或搭配"
            aria-label="搜索教材词汇"
          />
          <button v-if="keyword" class="search-clear" type="button" aria-label="清空搜索" @click="keyword = ''">
            <AppIcon name="close" :size="12" />
          </button>
        </label>

        <label class="vb-field">
          <select v-model="searchScope" class="vb-select" aria-label="搜索范围">
            <option value="unit">当前单元</option>
            <option value="book">当前册次</option>
            <option value="all">全部册次</option>
          </select>
        </label>

        <span v-if="crossSearch" class="vb-scope-note">当前范围：{{ scopeLabel }}</span>

        <div class="vb-toolbar-actions">

        <label class="vb-check">
          <input v-model="useExercises" type="checkbox" />
          <span>使用练习题</span>
        </label>
        <button
          class="btn btn-ghost btn-sm"
          type="button"
          :disabled="!entries.length || crossSearch"
          :title="crossSearch ? '跨单元检索时请先切回当前单元' : '查看本单元词条的练习'"
          @click="openPractice"
        >
          查看练习
        </button>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          :disabled="!entries.length || crossSearch"
          :title="crossSearch ? '跨单元检索时请先切回当前单元' : '挑词生成单词演示文件'"
          @click="startPrepare"
        >
          导出
        </button>
        </div>
      </div>

      <BulkBar
        v-if="preparing"
        :all="allPrepared"
        :count="pickedCount"
        :total="entries.length"
        ok-label="导出演示文件"
        :ok-disabled="!pickedCount"
        @toggle-all="togglePrepareAll"
        @cancel="cancelPrepare"
        @confirm="startDemo"
      >
        <template #before-cancel>
          <WordSheetMenu :disabled="!pickedCount" :busy="sheetBusy" @export="exportSheet" />
        </template>
      </BulkBar>

      <div v-if="pasteOpen" class="paste-box">
        <div class="paste-head">
          <span class="paste-title">
            <AppIcon name="copy" :size="15" />
            粘贴文本
          </span>
          <span class="field-hint">
            将教材词汇的词与搭配文本粘贴到下方（可多行），例如：curious: be curious about sth.
          </span>
        </div>
        <textarea
          v-model="pasteText"
          class="textarea paste-input"
          rows="4"
          spellcheck="false"
          placeholder="Unit 3　Words and expressions&#10;1. abandon v. 放弃，抛弃　abandon oneself to 沉溺于&#10;2. aboard adv. 在船上"
        ></textarea>
        <div class="paste-foot">
          <button
            class="btn btn-primary btn-sm icon-text"
            type="button"
            :disabled="collocationBusy || !pasteText.trim()"
            @click="extract('paste')"
          >
            <AppIcon name="sparkles" :size="14" />
            {{ collocationBusy ? '识别中…' : '识别搭配' }}
          </button>
          <button class="btn btn-ghost btn-sm" type="button" @click="closePaste">取消</button>
          <span class="field-hint">本次会带上 {{ entries.length }} 个词做匹配。</span>
        </div>
      </div>

      <div v-if="!crossSearch" class="vocab-table-wrap">
        <table class="vocab-table textbook-table">
          <thead>
            <tr>
              <th v-if="preparing" class="col-check" scope="col"></th>
              <th class="col-order" scope="col">序号</th>
              <th class="col-word" scope="col">单词 / 音标</th>
              <th class="col-pos" scope="col">词性</th>
              <th class="col-meaning" scope="col">释义</th>
              <th class="col-collocation" scope="col">固定搭配</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in visibleEntries" :key="entry.order" :class="{ 'row-picked': picked.includes(`t:${entry.order}`) }">
              <td v-if="preparing" class="col-check">
                <input
                  type="checkbox"
                  :checked="picked.includes(`t:${entry.order}`)"
                  :aria-label="`选择 ${entry.word}`"
                  @change="togglePickKey(`t:${entry.order}`)"
                />
              </td>
              <td class="col-order">{{ entry.order }}</td>
              <td class="col-word">
                <span class="mv-word">
                  {{ entry.word }}
                  <sup v-if="entry.mark" class="vocab-mark" :title="MARK_LEGEND[entry.mark]">{{ entry.mark }}</sup>
                </span>
                <span class="mv-ipa">{{ entry.ipa || '—' }}</span>
              </td>
              <td class="col-pos">
                <span v-if="entry.partOfSpeech" class="vocab-pos">{{ entry.partOfSpeech }}</span>
                <span v-else class="muted-light">—</span>
              </td>
              <td class="col-meaning">{{ entry.meaning }}</td>
              <td class="col-collocation">
                <CollocCell
                  :value="collocationText(entry)"
                  :entries="collocationEntries(entry)"
                  :hint="collocationHint(entry)"
                  :disabled="collocationBusy"
                  @save="(text) => saveCollocation(entry.order, text)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!visibleEntries.length" class="empty">
          <p v-if="keyword">本单元没有匹配「{{ keyword }}」的词条，可把范围切到「当前册次」再找。</p>
          <p v-else>这一单元暂无词条。</p>
        </div>
      </div>

      <div v-else class="vocab-table-wrap">
        <table class="vocab-table textbook-table cross-table">
          <thead>
            <tr>
              <th class="col-order" scope="col">序号</th>
              <th class="col-word" scope="col">单词 / 音标</th>
              <th class="col-pos" scope="col">词性</th>
              <th class="col-meaning" scope="col">释义</th>
              <th class="col-collocation" scope="col">固定搭配</th>
              <th class="col-source" scope="col">来源</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="hit in searchHits" :key="hit.key">
              <td class="col-order">{{ hit.entry.order }}</td>
              <td class="col-word">
                <span class="mv-word">
                  <template v-for="(part, index) in splitHit(hit.entry.word)" :key="`w${index}`">
                    <mark v-if="part.hit" class="hit-mark">{{ part.text }}</mark>
                    <span v-else>{{ part.text }}</span>
                  </template>
                  <sup v-if="hit.entry.mark" class="vocab-mark" :title="MARK_LEGEND[hit.entry.mark]">{{ hit.entry.mark }}</sup>
                </span>
                <span class="mv-ipa">{{ hit.entry.ipa || '—' }}</span>
              </td>
              <td class="col-pos">
                <span v-if="hit.entry.partOfSpeech" class="vocab-pos">{{ hit.entry.partOfSpeech }}</span>
                <span v-else class="muted-light">—</span>
              </td>
              <td class="col-meaning">
                <template v-for="(part, index) in splitHit(hit.entry.meaning)" :key="`m${index}`">
                  <mark v-if="part.hit" class="hit-mark">{{ part.text }}</mark>
                  <span v-else>{{ part.text }}</span>
                </template>
              </td>
              <td class="col-collocation">
                <template v-if="hit.entry.collocations.length">
                  <template v-for="(part, index) in splitHit(hitCollocation(hit))" :key="`c${index}`">
                    <mark v-if="part.hit" class="hit-mark">{{ part.text }}</mark>
                    <span v-else>{{ part.text }}</span>
                  </template>
                </template>
                <span v-else class="muted-light">—</span>
              </td>
              <td class="col-source">{{ hit.bookShort }} · Unit {{ hit.unitNumber }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="!searchHits.length" class="empty">
          <p>{{ scopeLabel }}里没有匹配「{{ keyword }}」的词条。</p>
        </div>
      </div>

      <div class="vocab-foot">
        <span v-if="marksInUnit.length" class="vocab-legend">
          <span v-for="item in marksInUnit" :key="item.mark">
            <b>{{ item.mark }}</b> {{ item.label }}
          </span>
        </span>
        <span class="spacer"></span>
        <span class="field-hint">{{ VOCAB_SOURCE }} · 共 {{ VOCAB_TOTAL }} 条</span>
      </div>
    </section>

    <section v-else class="panel vocab-panel" aria-labelledby="my-vocab-heading">
      <div class="mv-layout" :class="{ 'with-editor': editorOpen }">
        <div class="mv-main">
          <div class="panel-head">
            <div class="panel-head-left">
              <span class="step" aria-hidden="true">Aa</span>
              <h2 id="my-vocab-heading" class="panel-title">
                我的词汇
                <span class="panel-title-sep">·</span>
                {{ myItems.length }} 条
              </h2>
            </div>
            <div class="panel-head-mid">
              <label class="search-field">
                <AppIcon name="search" :size="15" />
                <input
                  v-model="mineKeyword"
                  class="input search-input"
                  type="search"
                  placeholder="单词、释义或搭配"
                  aria-label="搜索我的词汇"
                />
                <button
                  v-if="mineKeyword"
                  class="search-clear"
                  type="button"
                  aria-label="清空搜索"
                  @click="mineKeyword = ''"
                >
                  <AppIcon name="close" :size="12" />
                </button>
              </label>
              <span v-if="mineKeyword" class="search-note">命中 {{ filteredMine.length }} 条</span>
            </div>
            <div class="block-actions">
              <button class="btn btn-ghost btn-sm icon-text" type="button" @click="openCreate">
                <AppIcon name="plus" :size="13" />
                添加词汇
              </button>
              <button class="btn btn-ghost btn-sm" type="button" :disabled="!filteredMine.length" @click="openPractice">
                查看练习
              </button>
              <button class="btn btn-primary btn-sm" type="button" :disabled="!filteredMine.length" @click="startPrepare">
                导出
              </button>
            </div>
          </div>

          <BulkBar
            v-if="selected.length && !preparing"
            :all="allPicked"
            :count="selected.length"
            :total="filteredMine.length"
            ok-label="删除所选"
            tone="danger"
            :ok-disabled="!selected.length"
            @toggle-all="togglePickAll"
            @cancel="selected = []"
            @confirm="removeSelected"
          />

          <BulkBar
            v-if="preparing"
            :all="allPrepared"
            :count="pickedCount"
            :total="filteredMine.length"
            ok-label="导出演示文件"
            :ok-disabled="!pickedCount"
            @toggle-all="togglePrepareAll"
            @cancel="cancelPrepare"
            @confirm="startDemo"
          >
            <label class="bulk-option">
              <input v-model="useExercises" type="checkbox" />
              <span>使用练习题</span>
            </label>
            <template #before-cancel>
              <WordSheetMenu :disabled="!pickedCount" :busy="sheetBusy" @export="exportSheet" />
            </template>
          </BulkBar>

          <div v-if="filteredMine.length" class="vocab-table-wrap">
            <table class="vocab-table mv-table">
              <thead>
                <tr>
                  <th class="col-check" scope="col">
                    <input
                      v-if="!preparing"
                      type="checkbox"
                      :checked="allPicked"
                      aria-label="全选"
                      @change="togglePickAll()"
                    />
                  </th>
                  <th class="col-order" scope="col">序号</th>
                  <th class="col-word" scope="col">单词 / 音标</th>
                  <th class="col-pos" scope="col">词性</th>
                  <th class="col-meaning" scope="col">释义</th>
                  <th class="col-collocation" scope="col">固定搭配</th>
                  <th class="col-action" scope="col"><span class="visually-hidden">操作</span></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(item, index) in filteredMine"
                  :key="item.id"
                  :class="{
                    'row-picked': preparing ? picked.includes(`m:${item.id}`) : selected.includes(item.id),
                    'row-current': editorOpen && editorId === item.id,
                  }"
                >
                  <td class="col-check">
                    <input
                      type="checkbox"
                      :checked="preparing ? picked.includes(`m:${item.id}`) : selected.includes(item.id)"
                      :aria-label="`选择 ${item.term}`"
                      @change="preparing ? togglePickKey(`m:${item.id}`) : togglePick(item.id)"
                    />
                  </td>
                  <td class="col-order">{{ index + 1 }}</td>
                  <td class="col-word">
                    <span class="mv-word">{{ item.term }}</span>
                    <span class="mv-ipa">{{ item.phonetic ? `/${item.phonetic}/` : '—' }}</span>
                  </td>
                  <td class="col-pos">
                    <span v-if="item.pos" class="vocab-pos">{{ item.pos }}</span>
                    <span v-else class="muted-light">—</span>
                  </td>
                  <td class="col-meaning">{{ item.meaning }}</td>
                  <td class="col-collocation">
                    <span v-if="item.collocation">{{ item.collocation }}</span>
                    <span v-else class="muted-light">待补充</span>
                  </td>
                  <td class="col-action">
                    <span class="row-more">
                      <button
                        class="icon-btn"
                        type="button"
                        :aria-label="`${item.term} 的操作`"
                        :aria-expanded="menuFor === item.id"
                        @click.stop="menuFor = menuFor === item.id ? '' : item.id"
                      >
                        <AppIcon name="more" :size="20" :stroke="3.3" />
                      </button>
                      <div v-if="menuFor === item.id" class="row-menu" :class="{ up: index >= filteredMine.length - 2 }" role="menu">
                        <button type="button" role="menuitem" @click.stop="openEdit(item)">
                          <AppIcon name="edit" :size="13" />
                          编辑
                        </button>
                        <button type="button" role="menuitem" class="danger" @click.stop="removeOne(item)">
                          <AppIcon name="trash" :size="13" />
                          删除
                        </button>
                      </div>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else-if="myItems.length" class="empty">
            <p>没有匹配「{{ mineKeyword }}」的词条。</p>
          </div>

          <div v-else class="empty vocab-empty">
            <span class="empty-mark" aria-hidden="true">Aa</span>
            <h3>还没有自己的词汇</h3>
            <p>从「文章解析 · 重点词汇」存入，或点上方「添加词汇」。</p>
          </div>

          <div v-if="selected.length" class="vocab-foot">
            <span class="spacer"></span>
            <span class="field-hint">已选 {{ selected.length }} 条</span>
          </div>
        </div>

        <aside v-if="editorOpen" class="side-editor" aria-label="词条编辑面板">
          <header class="side-head">
            <div class="side-head-row">
              <h3>{{ editorMode === 'create' ? '添加词汇' : '编辑词汇' }}</h3>
              <button class="icon-btn" type="button" aria-label="关闭面板" @click="closeEditor()">
                <AppIcon name="close" :size="16" />
              </button>
            </div>
            <p class="side-sub">填写单词与释义即可保存。</p>
          </header>

          <form class="side-form" @submit.prevent="saveDraft(false)">
            <div class="side-scroll">
              <label class="field">
              <span class="field-label">单词 / 短语 <em class="req">*</em></span>
              <input
                ref="termInput"
                v-model="draft.term"
                class="input"
                placeholder="take up"
                autocomplete="off"
                @input="dupWarning = ''"
              />
            </label>

            <label class="field">
              <span class="field-label">释义 <em class="req">*</em></span>
              <textarea
                v-model="draft.meaning"
                class="textarea"
                rows="2"
                placeholder="开始从事；占用"
              ></textarea>
            </label>

            <p class="side-divider"><span>可选信息</span></p>

            <div class="side-grid">
              <label class="field">
                <span class="field-label">音标</span>
                <input v-model="draft.phonetic" class="input" placeholder="/teɪk ʌp/" />
              </label>
              <label class="field">
                <span class="field-label">词性</span>
                <input v-model="draft.pos" class="input" placeholder="phr. v." />
              </label>
            </div>

            <label class="field">
              <span class="field-label">固定搭配</span>
              <textarea
                v-model="draft.collocation"
                class="textarea"
                rows="2"
                placeholder="take up doing sth. 开始做某事"
              ></textarea>
            </label>

            <div class="side-preview">
              <p class="side-preview-word">
                <span class="side-preview-label">预览</span>
                <b>{{ draft.term.trim() || '单词' }}</b>
                <span v-if="draft.pos.trim()" class="vocab-pos">{{ draft.pos.trim() }}</span>
              </p>
              <p class="side-preview-meaning">{{ draft.meaning.trim() || '释义会显示在这里' }}</p>
            </div>

            </div>

            <p v-if="dupWarning" class="side-warn">{{ dupWarning }}</p>
            <div v-if="discardAsk" class="side-confirm">
              <span>还有没保存的内容，关闭后会丢失。</span>
              <div class="side-confirm-actions">
                <button class="btn btn-ghost btn-sm" type="button" @click="discardAsk = false">继续编辑</button>
                <button class="btn btn-danger btn-sm" type="button" @click="forceCloseEditor">放弃并关闭</button>
              </div>
            </div>
            <footer class="side-foot">
              <span class="side-req"><em class="req">*</em> 为必填</span>
              <button class="btn btn-ghost btn-sm" type="button" @click="closeEditor()">取消</button>
              <button
                v-if="editorMode === 'create'"
                class="btn btn-ghost btn-sm"
                type="button"
                :disabled="saving"
                @click="saveDraft(true)"
              >
                保存并继续
              </button>
              <button class="btn btn-primary btn-sm" type="submit" :disabled="saving">
                {{ saving ? '保存中…' : '保存词条' }}
              </button>
            </footer>
          </form>
        </aside>
      </div>
    </section>
    </template>
  </div>
</template>
