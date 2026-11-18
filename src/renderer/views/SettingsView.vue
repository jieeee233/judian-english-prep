<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { AppInfo } from '../../shared/api';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_VISION_MODEL,
  MODEL_PRESETS,
  VISION_MODEL_PRESETS,
} from '../../shared/constants';
import { showToast, store } from '../store';
import { desktop } from '../useDesktop';
import AppIcon from '../components/AppIcon.vue';

const form = ref({
  baseUrl: DEFAULT_BASE_URL,
  model: DEFAULT_MODEL,
  visionModel: DEFAULT_VISION_MODEL,
  timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  apiKey: '',
});

const preset = ref(MODEL_PRESETS.some((item) => item.id === DEFAULT_MODEL) ? DEFAULT_MODEL : 'custom');
const visionPreset = ref(
  VISION_MODEL_PRESETS.some((item) => item.id === DEFAULT_VISION_MODEL) ? DEFAULT_VISION_MODEL : 'custom',
);
const revealKey = ref(false);
const saving = ref(false);
const clearing = ref(false);
const error = ref('');
const notice = ref('');
const info = ref<AppInfo | null>(null);
const securityOpen = ref(false);

const modelNote = computed(() => {
  const found = MODEL_PRESETS.find((item) => item.id === form.value.model);
  if (found) return `${found.id} · ${found.note}`;
  return '自定义模型需支持 OpenAI 兼容的 /chat/completions。';
});

function applyPreset() {
  if (preset.value !== 'custom') form.value.model = preset.value;
}

function applyVisionPreset() {
  if (visionPreset.value !== 'custom') form.value.visionModel = visionPreset.value;
}

const savedHint = computed(() => {
  if (!store.settings.hasKey) return '尚未保存密钥';
  return store.settings.keyPersisted
    ? '已用系统凭据加密保存到本机'
    : '仅本次会话有效（系统加密不可用）';
});

async function refresh() {
  try {
    const settings = await desktop().getSettings();
    store.settings = settings;
    form.value.baseUrl = settings.baseUrl;
    form.value.model = settings.model;
    form.value.visionModel = settings.visionModel || DEFAULT_VISION_MODEL;
    form.value.timeoutSeconds = settings.timeoutSeconds;
    form.value.apiKey = '';
    preset.value = MODEL_PRESETS.some((item) => item.id === settings.model)
      ? settings.model
      : 'custom';
    visionPreset.value = VISION_MODEL_PRESETS.some((item) => item.id === settings.visionModel)
      ? settings.visionModel
      : 'custom';
  } catch {
    error.value = '无法读取本地设置，请重新启动应用后重试。';
  }
}

async function save() {
  if (saving.value) return;
  error.value = '';
  notice.value = '';
  if (!form.value.baseUrl.trim() || !form.value.model.trim()) {
    error.value = '请填写服务地址和模型名称。';
    return;
  }
  if (!form.value.apiKey.trim() && !store.settings.hasKey) {
    error.value = '请填写 API 密钥。';
    return;
  }

  saving.value = true;
  try {
    const response = await desktop().saveSettings({
      baseUrl: form.value.baseUrl,
      model: form.value.model,
      visionModel: form.value.visionModel,
      timeoutSeconds: Number(form.value.timeoutSeconds),
      apiKey: form.value.apiKey,
    });
    if (!response.ok) {
      error.value = response.message;
      return;
    }
    await refresh();
    notice.value = response.persisted
      ? '已保存并用系统凭据加密，下次启动自动恢复。保存不发起网络请求，请回到解析页验证服务与模型。'
      : '已保存，但系统加密不可用：密钥只在本次会话有效，退出后需要重新输入。';
    showToast('ok', 'API 设置已保存。');
  } catch {
    error.value = '保存失败，请稍后重试。设置内容不会写入日志。';
  } finally {
    saving.value = false;
  }
}

async function clear() {
  if (clearing.value) return;
  if (!window.confirm('确定清除本机保存的 API 设置与密钥？')) return;
  clearing.value = true;
  error.value = '';
  notice.value = '';
  try {
    const response = await desktop().clearSettings();
    if (!response.ok) {
      error.value = response.message;
      return;
    }
    await refresh();
    showToast('ok', '本机保存的 API 设置与密钥已清除。');
  } catch {
    error.value = '清除失败，请重试。';
  } finally {
    clearing.value = false;
  }
}

onMounted(async () => {
  await refresh();
  try {
    info.value = await desktop().appInfo();
  } catch {
    info.value = null;
  }
});
</script>

<template>
  <div class="page st-page">
    <div class="st-wrap">
      <section class="st-card" aria-labelledby="api-heading">
        <header class="st-head">
          <h1 id="api-heading">API 设置</h1>
          <span class="st-head-note">{{ savedHint }}</span>
        </header>

        <label class="st-row">
          <span class="st-label">服务地址（Base URL）</span>
          <span class="st-field">
            <input
              v-model="form.baseUrl"
              class="st-input"
              type="url"
              spellcheck="false"
              placeholder="https://api.siliconflow.cn/v1"
            />
            <span class="st-hint">填写到 /v1，勿包含 /chat/completions。</span>
          </span>
        </label>

        <div class="st-row">
          <span class="st-label">API 密钥</span>
          <div class="st-field st-key">
            <input
              v-model="form.apiKey"
              class="st-input"
              :type="revealKey ? 'text' : 'password'"
              spellcheck="false"
              autocomplete="off"
              :placeholder="store.settings.hasKey ? '已保存，留空则不修改' : '粘贴你的 API 密钥'"
            />
            <button class="st-reveal" type="button" @click="revealKey = !revealKey">
              {{ revealKey ? '隐藏' : '显示' }}
            </button>
          </div>
        </div>

        <div class="st-row">
          <span class="st-label">
            <AppIcon name="sparkles" :size="16" />
            模型
          </span>
          <div class="st-field">
            <select v-model="preset" class="st-select" :title="modelNote" @change="applyPreset">
              <option v-for="item in MODEL_PRESETS" :key="item.id" :value="item.id">
                {{ item.label }}
              </option>
              <option value="custom">自定义模型…</option>
            </select>
            <input
              v-if="preset === 'custom'"
              v-model="form.model"
              class="st-input"
              style="margin-top: 8px"
              type="text"
              spellcheck="false"
              placeholder="例如 Qwen/Qwen3.5-4B"
            />
          </div>
        </div>

        <div class="st-row">
          <span class="st-label">
            <AppIcon name="image" :size="16" />
            视觉模型
          </span>
          <div class="st-field">
            <select v-model="visionPreset" class="st-select" @change="applyVisionPreset">
              <option v-for="item in VISION_MODEL_PRESETS" :key="item.id" :value="item.id">
                {{ item.label }}
              </option>
              <option value="custom">自定义模型…</option>
            </select>
            <input
              v-if="visionPreset === 'custom'"
              v-model="form.visionModel"
              class="st-input"
              style="margin-top: 8px"
              type="text"
              spellcheck="false"
              placeholder="例如 Qwen/Qwen2.5-VL-7B-Instruct"
            />
          </div>
        </div>

        <label class="st-row">
          <span class="st-label">超时（秒）</span>
          <span class="st-field">
            <input
              v-model.number="form.timeoutSeconds"
              class="st-input st-mini"
              type="number"
              min="30"
              max="300"
              step="1"
            />
            <span class="st-hint">30–300 秒，超时停止，不自动重试。</span>
          </span>
        </label>

        <div v-if="error || notice" class="st-msg">
          <div v-if="error" class="alert error" role="alert">
            <span aria-hidden="true">!</span>
            <span>{{ error }}</span>
          </div>
          <div v-else class="alert ok" role="status">
            <span aria-hidden="true">✓</span>
            <span>{{ notice }}</span>
          </div>
        </div>

        <div class="st-actions">
          <button class="st-clear" type="button" :disabled="clearing" @click="clear">
            {{ clearing ? '清除中…' : '清除本机设置' }}
          </button>
          <button class="btn btn-primary st-save" type="button" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存设置' }}
          </button>
        </div>
      </section>

      <section class="st-fold" :class="{ open: securityOpen }">
        <button class="st-fold-head" type="button" :aria-expanded="securityOpen" @click="securityOpen = !securityOpen">
          <AppIcon name="shield" :size="17" />
          <b>存储与安全</b>
          <span class="st-fold-note">本机加密保存 · 文章仅发送到所配置的模型服务</span>
          <AppIcon name="chevron-down" :size="15" class="st-fold-caret" />
        </button>
        <div v-if="securityOpen" class="st-fold-body">
          <p>密钥经系统凭据（Windows DPAPI）加密后保存在本机用户目录，不上传第三方。</p>
          <p>历史记录与设置都在本机，清除后无法恢复。</p>
          <p>文章只在发起解析时发送到你配置的服务地址，超时即中止，全程不自动重试。</p>
          <div class="st-facts" style="padding: 8px 0 0">
            <span>应用版本 <b>{{ info?.version ?? '—' }}</b></span>
            <span>Electron <b>{{ info?.electron ?? '—' }}</b></span>
            <span>系统加密 <b>{{ store.settings.encryptionAvailable ? '可用' : '不可用' }}</b></span>
            <span>数据目录 <b>{{ info?.dataDir ?? '—' }}</b></span>
          </div>
        </div>
      </section>

      <div class="st-version">
        <span>应用版本 {{ info?.version ?? '—' }}</span>
        <i>·</i>
        <span>Electron {{ info?.electron ?? '—' }}</span>
        <i>·</i>
        <span>系统加密{{ store.settings.encryptionAvailable ? '可用' : '不可用' }}</span>
        <i>·</i>
        <span>数据目录 本机用户目录（脱敏）</span>
      </div>
    </div>
  </div>
</template>
