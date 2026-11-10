import { decodeLabel, evaluatePolicy, parseEvidence, TrustStore } from './verify.js';

const $ = (id) => document.getElementById(id);
const storageKey = 'scp-sl-auth-qr.history.v1';
const recordLimit = 80;
const fileLimit = 12;
const trust = new TrustStore();
const state = { history: readHistory(), active: null, busy: false, tab: 'fields', utc: false, offlineReady: false };
const dates = {
  local: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', hour12: false }),
  utc: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', hour12: false, timeZone: 'UTC' }),
};

const groups = [
  ['玩家身份', [
    ['Nickname', '认证昵称', '签发时的昵称，字段本身经过 Base64 编码。'],
    ['UserId', '平台账号', '中央认证确认的平台账号，后缀表示账号来源。'],
    ['PlayerId', '本服编号', '连接时分配的可回收编号，对应 Remote Admin 玩家列表。'],
  ]],
  ['签发与会话', [
    ['IssuedBy', '签发节点', '中央服务写入的节点标签。'],
    ['Serial', '令牌序列号', '可与游戏服认证日志中的序列号核对。'],
    ['IssuanceTime', '签发时间', '认证令牌签发时间。'],
    ['ExpirationTime', '过期时间', '用于进服认证的截止时间。'],
    ['TokenVersion', '协议版本', '当前支持 Authentication 令牌协议版本 2。'],
    ['Usage', '令牌用途', '进服认证期望 Authentication。'],
    ['TestSignature', '测试专用', '启用时仅适用于测试中央服务。'],
    ['Challenge', '连接挑战值', '绑定到进服时游戏服发出的随机挑战。'],
    ['PublicKey', '客户端公钥指纹', '客户端 ECDSA 公钥文本的 SHA-256 十六进制指纹，再经过 Base64 编码。'],
    ['GameVersion', '允许的最高版本', '可选。存在时，游戏服会与自身版本比较。'],
  ]],
  ['网络与账号状态', [
    ['RequestIp', '认证请求 IP', '中央认证请求中记录的地址。'],
    ['Asn', '自治系统编号', '中央服务记录的网络自治系统编号。'],
    ['GlobalBan', '全局处罚', 'NO 表示签发时无全局处罚；M1 / M2 对应禁言状态。'],
    ['VacSession', 'VAC 会话', '中央服务记录的 VAC 会话状态。'],
    ['SkipIpCheck', '跳过同 IP 检查', '控制游戏服是否跳过该令牌的同 IP 检查。'],
    ['DoNotTrack', '不追踪标记', '令牌内的隐私标记，游戏服还会结合客户端设置。'],
    ['SyncHashed', '强制哈希同步', '影响同步给其他客户端的账号 ID 形式。'],
  ]],
  ['权限与资格', [
    ['BypassBans', '绕过封禁', '游戏服的部分封禁检查会读取该标记。'],
    ['BypassGeoRestrictions', '绕过地区限制', '认证载荷中的地区限制绕过标记。'],
    ['BypassWhitelists', '绕过白名单', '认证载荷中的白名单绕过标记。'],
    ['GlobalBadge', '全局徽章标记', '实际徽章展示还会校验独立的徽章令牌。'],
    ['PrivateBetaOwnership', '私测资格', '声明是否拥有 Private Beta Access Pass。'],
  ]],
];
const knownKeys = new Set(groups.flatMap(([, fields]) => fields.map(([key]) => key)));
const signatures = {
  verified: ['签名通过', 'good', '原始 token 通过 Northwood 可信公钥验证。'],
  mismatch: ['签名未匹配', 'bad', '当前可信公钥均未匹配。可能是内容被改动，或缺少对应签发密钥。'],
  malformed: ['签名格式错误', 'bad', 'signature 无法解析为 DER ECDSA 签名。'],
  unavailable: ['缺少可信公钥', 'warn', '仍可查看字段。请联网同步公钥后重新验签。'],
};
const validity = {
  current: ['在认证窗口内', 'good'], expired: ['认证窗口已过期', 'warn'],
  future: ['签发时间异常', 'warn'], version: ['协议版本不支持', 'warn'],
  usage: ['令牌用途不匹配', 'warn'], test: ['测试专用令牌', 'warn'],
  invalid: ['认证字段不完整', 'warn'],
};

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== '') element.textContent = text;
  return element;
}

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '/assets/icons.svg#' + name);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use);
  return svg;
}

function button(text, symbol, callback, type = 'secondary') {
  const element = node('button', 'button ' + type);
  element.type = 'button';
  if (symbol) element.append(icon(symbol));
  element.append(text);
  element.addEventListener('click', callback);
  return element;
}

function readHistory() {
  try {
    const values = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(values)) return values.filter((item) =>
      item && typeof item.fingerprint === 'string' && item.envelope && typeof item.note === 'string').slice(0, recordLimit);
  } catch {
    // This browser may deny persistent storage or contain an older, damaged history.
  }
  return [];
}

function saveHistory() {
  try {
    const serialized = JSON.stringify(state.history);
    localStorage.setItem(storageKey, serialized);
  } catch {
    toast('浏览器无法保存查询记录。本次打开页面内仍可查看。');
  }
}

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3700);
}

function activity(message, tone = '') {
  $('activity').hidden = !message;
  $('activity').textContent = message;
  $('activity').dataset.tone = tone;
}

function setBusy(busy) {
  state.busy = busy;
  for (const id of ['choose', 'paste', 'verify-json', 'open-camera']) $(id).disabled = busy;
  $('clear-history').disabled = busy || state.history.length === 0;
}

function setMode(mode) {
  const image = mode === 'image';
  $('mode-image').setAttribute('aria-pressed', image);
  $('mode-json').setAttribute('aria-pressed', !image);
  $('image-input').hidden = !image;
  $('json-input').hidden = image;
}

function time(value, utc = state.utc) {
  return Number.isFinite(value) ? dates[utc ? 'utc' : 'local'].format(value) + (utc ? ' UTC' : '') : '—';
}

function nickname(payload) {
  return decodeLabel(payload.Nickname) || (typeof payload.Nickname === 'string' ? payload.Nickname : '') || '未知玩家';
}

function signatureInfo(status) {
  return Object.hasOwn(signatures, status) ? signatures[status] : signatures.unavailable;
}

function renderHistory() {
  const query = $('history-search').value.trim().toLowerCase();
  const filter = $('history-filter').value;
  $('history-count').textContent = state.history.length;
  $('clear-history').disabled = state.busy || !state.history.length;
  $('history-list').replaceChildren();
  const matches = state.history.filter((item) => {
    const text = [item.nickname, item.userId, item.serial, item.source, item.note, item.fingerprint].join(' ').toLowerCase();
    return text.includes(query) && (!filter || (item.signatureStatus === 'verified') === (filter === 'verified'));
  });
  if (!matches.length) {
    const empty = node('div', 'history-empty');
    empty.append(icon('history'), node('h3', '', state.history.length ? '没有匹配的记录' : '暂无查询记录'),
      node('p', '', state.history.length ? '试试其他关键词或筛选条件。' : '识别后自动保存到此浏览器。'));
    $('history-list').append(empty);
    return;
  }
  for (const item of matches) {
    const [label, tone] = signatureInfo(item.signatureStatus);
    const row = node('button', 'history-row');
    row.type = 'button';
    row.setAttribute('aria-current', item.fingerprint === state.active?.record.fingerprint);
    row.append(node('strong', '', String(item.nickname || '未知玩家')),
      node('span', 'badge ' + tone, label),
      node('span', 'history-account', String(item.userId || '账号未提供')),
      node('span', 'history-date', time(item.lastSeen, false) + ' · ' + item.count + ' 次查询'));
    row.addEventListener('click', () => openRecord(item));
    $('history-list').append(row);
  }
}

function rawValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'true · 是' : 'false · 否';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function fieldValue(key, payload, policy) {
  const value = payload[key];
  if (key === 'Nickname' || key === 'PublicKey') {
    const decoded = decodeLabel(value);
    if (decoded && decoded !== value) return decoded + '\n' + rawValue(value);
  }
  if (key === 'IssuanceTime' && policy.issuedAt !== null) return time(policy.issuedAt) + '\n' + value;
  if (key === 'ExpirationTime' && policy.expiresAt !== null) return time(policy.expiresAt) + '\n' + value;
  if (key === 'Asn' && Number.isInteger(value)) return 'AS' + value;
  return rawValue(value);
}

function renderFields(payload, policy) {
  const fragment = document.createDocumentFragment();
  const additional = Object.keys(payload).filter((key) => !knownKeys.has(key)).map((key) => [key, '', '额外的签名载荷字段。']);
  const fieldGroups = additional.length ? [...groups, ['其他字段', additional]] : groups;
  for (const [title, fields] of fieldGroups) {
    const group = node('section', 'group');
    const list = node('dl', 'field');
    group.append(node('h4', '', title), list);
    for (const [key, label, description] of fields) {
      const row = node('div', 'field-row');
      const term = node('dt', 'mono', key);
      if (label) term.append(node('small', '', label));
      const value = node('dd', 'mono', Object.hasOwn(payload, key) ? fieldValue(key, payload, policy) : '未提供');
      value.append(node('small', '', description));
      row.append(term, value);
      list.append(row);
    }
    fragment.append(group);
  }
  return fragment;
}

function renderChecks(policy, record) {
  const fragment = document.createDocumentFragment();
  const list = node('ul', 'checks');
  for (const [code, label, pass] of policy.checks) {
    const check = node('li', pass ? 'good' : 'warn');
    check.dataset.check = code;
    check.append(icon(pass ? 'check' : 'alert'), (pass ? '通过 · ' : '未通过 · ') + label);
    list.append(check);
  }
  fragment.append(list, node('p', 'notice', '验签算法 ECDSA P-521 / SHA-256，输入为原始 Base64 token 字符串。'),
    node('p', 'notice mono', '签名公钥 SHA-256：' + (record.signingKey || '—')),
    node('p', 'notice mono', '令牌指纹 SHA-256：' + record.fingerprint),
    node('p', 'notice', '使用本机时钟判断认证窗口。进服还要核对本次连接的挑战值、编号和密钥。'));
  return fragment;
}

function renderRaw(evidence) {
  const fragment = document.createDocumentFragment();
  const json = JSON.stringify(evidence.envelope, null, 2);
  fragment.append(button('复制签名 JSON', 'copy', () => copyText(json)),
    node('pre', 'raw-block', json), node('h3', '', '解码载荷'),
    node('pre', 'raw-block', JSON.stringify(evidence.payload, null, 2)));
  return fragment;
}

function renderReport() {
  const report = $('report');
  if (!state.active) {
    $('result-id').textContent = '等待识别';
    const empty = node('div', 'report-empty');
    const badge = node('span', 'empty-icon');
    badge.append(icon('shield'));
    const text = node('div');
    text.append(node('h3', '', '还没有核验报告'), node('p', '', '导入大二维码后，这里会分别显示签名和认证时效。'));
    empty.append(badge, text);
    report.replaceChildren(empty);
    return;
  }
  const { evidence, record } = state.active;
  const payload = evidence.payload;
  const policy = evaluatePolicy(payload);
  $('result-id').textContent = '#' + record.fingerprint.slice(0, 8).toUpperCase();
  const body = node('div', 'report-body');
  const identity = node('div', 'identity');
  const person = node('div');
  person.append(node('h3', '', nickname(payload)), node('p', 'mono', rawValue(payload.UserId)));
  const actions = node('div', 'report-actions');
  actions.append(button('重新验签', 'refresh', reverify),
    button('脱敏导出', 'download', exportReport),
    button(state.utc ? '显示本地时间' : '显示 UTC', 'clock', () => { state.utc = !state.utc; renderReport(); }));
  identity.append(person, actions);
  const [sign, signTone, signDetail] = signatureInfo(record.signatureStatus);
  const [windowLabel, windowTone] = validity[policy.status];
  const verdicts = node('div', 'verdicts');
  for (const [heading, label, tone, detail] of [
    ['签名真实性', sign, signTone, signDetail],
    ['进服认证时效', windowLabel, windowTone, policy.datesValid ? '截止 ' + time(policy.expiresAt) : '请检查签发与过期时间。'],
  ]) {
    const verdict = node('div', 'verdict');
    const value = node('strong', tone, label);
    if (heading === '进服认证时效') value.id = 'validity-label';
    verdict.append(node('span', 'verdict-label', heading), value, node('small', '', detail));
    verdicts.append(verdict);
  }
  const meta = node('div', 'report-meta');
  meta.append(node('span', '', '来源 · ' + record.source), node('span', '', '核验 · ' + time(record.verifiedAt)),
    node('span', '', '可信公钥 · ' + record.keyCount));
  if (policy.datesValid) meta.append(node('span', '', '令牌期限 · ' + (policy.expiresAt - policy.issuedAt) / 1000 + ' 秒'));
  const nav = node('div', 'report-nav');
  for (const [tab, label] of [['fields', '完整字段'], ['checks', '核验依据'], ['raw', '原始数据']]) {
    const toggle = button(label, null, () => { state.tab = tab; renderReport(); });
    toggle.setAttribute('aria-pressed', state.tab === tab);
    nav.append(toggle);
  }
  const content = node('div', 'report-content');
  if (state.tab === 'checks') content.append(renderChecks(policy, record));
  else if (state.tab === 'raw') content.append(renderRaw(evidence));
  else content.append(renderFields(payload, policy));

  const note = node('label', 'note', '本机备注');
  const textarea = node('textarea');
  textarea.rows = 2;
  textarea.maxLength = 300;
  textarea.placeholder = '记录举报视频时间点、复核情况或内部编号';
  textarea.value = record.note;
  textarea.addEventListener('input', () => {
    record.note = textarea.value;
    saveHistory();
  });
  note.append(textarea);
  const remove = button('删除此记录', 'trash', () => {
    state.history = state.history.filter((item) => item.fingerprint !== record.fingerprint);
    state.active = null;
    saveHistory();
    renderHistory();
    renderReport();
    toast('已删除此记录。');
  });
  const end = node('div', 'report-end');
  end.append(remove, node('span', 'subtle', '备注自动保存到此浏览器'));
  body.append(identity, verdicts, meta, note, nav, content, end);
  report.replaceChildren(body);
}

function updateValidity() {
  const current = $('validity-label');
  if (!state.active || !current) return;
  const policy = evaluatePolicy(state.active.evidence.payload);
  const [label, tone] = validity[policy.status];
  if (current.textContent === label) return;
  current.textContent = label;
  current.className = tone;
  if (state.tab === 'checks') {
    $('report').querySelector('.report-content').replaceChildren(renderChecks(policy, state.active.record));
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制。');
  } catch {
    toast('剪贴板不可用。可以在原始数据中手动复制。');
  }
}

function exportReport() {
  if (!state.active) return;
  const { record, evidence: { payload } } = state.active;
  const policy = evaluatePolicy(payload);
  const redacted = {
    schema: 'scpsl-auth-qr-redacted-v1',
    exportedAt: new Date().toISOString(),
    signatureStatus: record.signatureStatus,
    authenticationWindow: policy.status,
    platform: typeof payload.UserId === 'string' ? /@(steam|discord)$/.exec(payload.UserId)?.[1] ?? null : null,
    playerId: Number.isInteger(payload.PlayerId) ? payload.PlayerId : null,
    issuedAt: policy.issuedAt === null ? null : new Date(policy.issuedAt).toISOString(),
    expiresAt: policy.expiresAt === null ? null : new Date(policy.expiresAt).toISOString(),
    protocolVersion: Number.isInteger(payload.TokenVersion) ? payload.TokenVersion : null,
    keyFingerprint: record.signingKey,
    evidenceFingerprint: record.fingerprint,
    checks: policy.checks.map(([code, , pass]) => ({ code, pass })),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(redacted, null, 2)], { type: 'application/json' }));
  const link = node('a');
  link.href = url;
  link.download = 'scpsl-qr-redacted-' + record.fingerprint.slice(0, 8) + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出脱敏报告。');
}

function putRecord(evidence, result, source) {
  const old = state.history.find((item) => item.fingerprint === result.fingerprint);
  const payload = evidence.payload;
  const record = {
    ...result,
    envelope: evidence.envelope,
    nickname: nickname(payload),
    userId: typeof payload.UserId === 'string' ? payload.UserId : '',
    serial: typeof payload.Serial === 'string' ? payload.Serial : '',
    source,
    firstSeen: old?.firstSeen ?? result.verifiedAt,
    lastSeen: result.verifiedAt,
    count: (old?.count || 0) + 1,
    note: old?.note ?? '',
  };
  state.history = [record, ...state.history.filter((item) => item.fingerprint !== result.fingerprint)].slice(0, recordLimit);
  state.active = { evidence, record };
  state.tab = 'fields';
  saveHistory();
  renderReport();
  renderHistory();
}

async function inspect(evidence, source) {
  await trustReady;
  putRecord(evidence, await trust.inspect(evidence), source);
}

async function openRecord(item, sync = false) {
  if (state.busy) return;
  setBusy(true);
  try {
    await trustReady;
    if (sync) await trust.refresh();
    const evidence = parseEvidence(JSON.stringify(item.envelope));
    Object.assign(item, await trust.inspect(evidence));
    state.active = { evidence, record: item };
    if (!sync) state.tab = 'fields';
    saveHistory();
    renderReport();
    renderHistory();
    if (sync) toast('已重新核验此记录。');
    else $('results').scrollIntoView({ block: 'nearest' });
  } catch (error) {
    toast(error.message || '无法打开此查询记录。');
  } finally {
    setBusy(false);
  }
}

function reverify() {
  if (state.active) openRecord(state.active.record, true);
}

function revealMobileReport() {
  if (matchMedia('(max-width: 680px)').matches) $('results').scrollIntoView({ block: 'start' });
}

let worker;
let scanId = 0;
function scanImage(image) {
  return new Promise((resolve, reject) => {
    worker ??= new Worker('/vendor/scanner-worker.js', { type: 'module' });
    const current = worker;
    const id = ++scanId;
    const cleanup = () => {
      clearTimeout(timer);
      current.removeEventListener('message', onMessage);
      current.removeEventListener('error', onError);
    };
    const onMessage = (event) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.texts);
    };
    const onError = () => {
      cleanup();
      current.terminate();
      if (worker === current) worker = null;
      reject(new Error('扫码组件加载失败。首次使用时请在线打开页面，等待离线资源准备完成。'));
    };
    const timer = setTimeout(onError, 10000);
    current.addEventListener('message', onMessage);
    current.addEventListener('error', onError);
    const transfers = image instanceof ImageData ? [image.data.buffer] : [];
    current.postMessage({ id, image }, transfers);
  });
}

function candidates(texts) {
  const matches = [];
  for (const text of texts) {
    try { matches.push(parseEvidence(text)); }
    catch { /* A screenshot may contain a small ID code or another unrelated QR. */ }
  }
  return matches;
}

async function importFiles(files, sourceLabel) {
  if (state.busy || cameraDialog.open || !files.length) return;
  setMode('image');
  setBusy(true);
  const problems = [];
  let imported = 0;
  try {
    if (files.length > fileLimit) problems.push('本批仅处理前 ' + fileLimit + ' 张图片。');
    const batch = files.slice(0, fileLimit);
    for (const [index, file] of batch.entries()) {
      const name = file.name || '剪贴板图片';
      activity('正在识别 ' + (index + 1) + ' / ' + batch.length + ' · ' + name);
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB。');
        if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|bmp|gif|avif)$/i.test(name)) {
          throw new Error('请选择 PNG、JPEG、WebP 等图片文件。');
        }
        const texts = await scanImage(file);
        const matches = candidates(texts);
        if (!matches.length) throw new Error(texts.length
          ? '识别到二维码，但没有有效的大二维码 JSON。请使用 REQUEST AUTH 大码。'
          : '未读出二维码。请换用清晰原图，或裁出大二维码并保留白边。');
        for (const evidence of matches) {
          await inspect(evidence, sourceLabel || name);
          imported++;
        }
      } catch (error) {
        problems.push(name + ' · ' + error.message);
      }
    }
    const lines = imported ? ['已识别 ' + imported + ' 个大二维码。', ...problems] : problems;
    activity(lines.join('\n'), problems.length ? 'error' : 'success');
    if (imported) revealMobileReport();
  } finally {
    setBusy(false);
  }
}

async function importJson(raw) {
  if (state.busy || cameraDialog.open) return;
  setBusy(true);
  activity('正在本机验签…');
  try {
    await inspect(parseEvidence(raw), '粘贴 JSON');
    $('token-text').value = '';
    activity('已读取 JSON 并生成核验报告。', 'success');
    revealMobileReport();
  } catch (error) {
    activity(error.message || '无法读取该令牌。', 'error');
  } finally {
    setBusy(false);
  }
}

async function pasteImage() {
  if (state.busy) return;
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const item of items) {
      const type = item.types.find((format) => format.startsWith('image/'));
      if (type) files.push(await item.getType(type));
    }
    if (files.length) await importFiles(files, '剪贴板图片');
    else activity('剪贴板中没有图片。先复制截图，再粘贴。', 'error');
  } catch {
    activity('浏览器未授权读取剪贴板。请直接按 Ctrl+V / ⌘V，或使用选择图片。', 'error');
  }
}

const cameraDialog = $('camera-dialog');
const cameraVideo = $('camera-video');
let cameraSession = null;
function stopCamera() {
  const session = cameraSession;
  cameraSession = null;
  if (session) {
    clearTimeout(session.timer);
    session.stream?.getTracks().forEach((track) => track.stop());
  }
  cameraVideo.srcObject = null;
}

async function startCamera() {
  if (state.busy || cameraDialog.open) return;
  cameraDialog.showModal();
  $('camera-status').textContent = '正在等待摄像头授权…';
  if (!navigator.mediaDevices?.getUserMedia) {
    $('camera-status').textContent = '当前浏览器无法访问摄像头。请使用 HTTPS，或改用截图导入。';
    return;
  }
  const session = {};
  cameraSession = session;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    if (cameraSession !== session) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    session.stream = stream;
    cameraVideo.srcObject = stream;
    await cameraVideo.play();
    $('camera-status').textContent = '让完整二维码进入取景框，并与摄像头保持平行。';
    const canvas = node('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    async function nextFrame() {
      if (cameraSession !== session) return;
      if (cameraVideo.readyState >= 2 && !state.busy) {
        try {
          const factor = Math.min(1, 1600 / Math.max(cameraVideo.videoWidth, cameraVideo.videoHeight));
          const width = Math.max(1, Math.round(cameraVideo.videoWidth * factor));
          const height = Math.max(1, Math.round(cameraVideo.videoHeight * factor));
          if (canvas.width !== width) canvas.width = width;
          if (canvas.height !== height) canvas.height = height;
          ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
          const texts = await scanImage(ctx.getImageData(0, 0, width, height));
          if (cameraSession !== session) return;
          const matches = candidates(texts);
          if (matches.length && !state.busy) {
            stopCamera();
            cameraDialog.close();
            setBusy(true);
            try {
              for (const evidence of matches) await inspect(evidence, '摄像头');
              activity('摄像头已识别 ' + matches.length + ' 个大二维码。', 'success');
              revealMobileReport();
            } catch (error) {
              activity(error.message, 'error');
            } finally {
              setBusy(false);
            }
            return;
          }
          if (texts.length) $('camera-status').textContent = '检测到其他二维码。请对准 REQUEST AUTH 的大码。';
        } catch (error) {
          stopCamera();
          $('camera-status').textContent = error.message || '无法读取画面，请重新打开摄像头。';
          return;
        }
      }
      session.timer = setTimeout(nextFrame, 260);
    }
    await nextFrame();
  } catch {
    if (cameraSession !== session) return;
    stopCamera();
    $('camera-status').textContent = '摄像头未授权或正在被占用。请检查浏览器权限，或使用截图导入。';
  }
}

function updateConnectivity() {
  $('connection').dataset.ready = state.offlineReady;
  $('connection-text').textContent = state.offlineReady
    ? (navigator.onLine ? '可离线使用' : '离线模式')
    : (state.offlineError ? '离线资源未就绪' : '正在准备离线资源');
  $('sync-keys').disabled = !navigator.onLine || !trust.root;
}

function updateKeys() {
  const count = trust.keys.size;
  const last = Date.parse(trust.lastRefresh);
  $('key-status').textContent = count
    ? '可信公钥 ' + count + ' 把 · ' + (Number.isFinite(last) ? '最近同步 ' + time(last, false) : '内置或本机缓存')
    : '可信公钥不可用';
  updateConnectivity();
}

async function syncKeys(manual = false) {
  if (manual) $('sync-keys').disabled = true;
  try {
    const synced = await trust.refresh();
    if (manual) toast(synced ? '已同步可信公钥。' : '暂时无法更新，仍可使用本机可信公钥。');
  } finally {
    updateKeys();
  }
}

const trustReady = trust.initialize();
trustReady.then(() => { updateKeys(); syncKeys(); }).catch((error) => {
  updateKeys();
  activity(error.message || '无法加载可信公钥。', 'error');
});

let installPrompt;
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; });
$('install').addEventListener('click', async () => {
  if (!installPrompt) {
    $('install-dialog').showModal();
    return;
  }
  try { await installPrompt.prompt(); }
  catch { $('install-dialog').showModal(); }
  finally { installPrompt = null; }
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(async (registration) => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'redundant' && !registration.active) {
        state.offlineError = true;
        updateConnectivity();
      }
    });
    await navigator.serviceWorker.ready;
    state.offlineReady = true;
    updateConnectivity();
  }).catch(() => { state.offlineError = true; updateConnectivity(); });
} else {
  state.offlineError = true;
}

$('mode-image').addEventListener('click', () => setMode('image'));
$('mode-json').addEventListener('click', () => { setMode('json'); $('token-text').focus(); });
$('choose').addEventListener('click', () => $('files').click());
$('files').addEventListener('change', (event) => {
  const files = Array.from(event.target.files);
  event.target.value = '';
  importFiles(files);
});
$('paste').addEventListener('click', pasteImage);
$('open-camera').addEventListener('click', startCamera);
cameraDialog.addEventListener('close', stopCamera);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && cameraDialog.open) {
    stopCamera();
    cameraDialog.close();
  }
});
window.addEventListener('pagehide', stopCamera);
$('json-input').addEventListener('submit', (event) => {
  event.preventDefault();
  importJson($('token-text').value.trim());
});
for (const control of document.querySelectorAll('[data-close]')) {
  control.addEventListener('click', () => $(control.dataset.close).close());
}
const dropzone = $('dropzone');
window.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  if (dropzone.contains(event.target)) dropzone.classList.add('dragging');
});
dropzone.addEventListener('dragleave', (event) => {
  if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('dragging');
});
window.addEventListener('drop', (event) => {
  dropzone.classList.remove('dragging');
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;
  event.preventDefault();
  importFiles(files);
});
document.addEventListener('paste', (event) => {
  const images = Array.from(event.clipboardData?.items || []).filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile()).filter(Boolean);
  if (images.length) {
    event.preventDefault();
    importFiles(images, '剪贴板图片');
    return;
  }
  if (event.target instanceof HTMLElement && (event.target.closest('input, textarea') || event.target.isContentEditable)) return;
  const raw = event.clipboardData?.getData('text/plain');
  if (raw?.trimStart().startsWith('{') && raw.includes('"token"') && raw.includes('"signature"')) {
    event.preventDefault();
    setMode('json');
    $('token-text').value = raw;
    importJson(raw);
  }
});
$('history-search').addEventListener('input', renderHistory);
$('history-filter').addEventListener('change', renderHistory);
$('clear-history').addEventListener('click', () => $('clear-dialog').showModal());
$('confirm-clear').addEventListener('click', () => {
  state.history = [];
  state.active = null;
  saveHistory();
  $('clear-dialog').close();
  renderHistory();
  renderReport();
  toast('本机查询记录已清空。');
});
$('sync-keys').addEventListener('click', () => syncKeys(true));
window.addEventListener('online', () => { updateConnectivity(); syncKeys(); });
window.addEventListener('offline', updateConnectivity);
window.addEventListener('focus', updateValidity);
setInterval(updateValidity, 10000);
window.addEventListener('storage', (event) => {
  if (event.key !== storageKey || state.busy) return;
  state.history = readHistory();
  if (state.active) {
    const record = state.history.find((item) => item.fingerprint === state.active.record.fingerprint);
    if (record) state.active.record = record;
    else state.active = null;
    renderReport();
  }
  renderHistory();
});
renderHistory();
updateConnectivity();
