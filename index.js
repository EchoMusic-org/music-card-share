const CARD_WIDTH = 750
const CARD_HEIGHT = 1000

// ── 通用工具 ──

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]),
  )

const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

const formatToday = () => {
  const now = new Date()
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
}

const nextPaint = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

// 等待容器内图片加载完成（error 也放行，避免单图失败卡死导出）
const waitForImages = (root, timeout = 6000) =>
  new Promise((resolve) => {
    const images = Array.from(root.querySelectorAll('img'))
    if (!images.length) return resolve()
    let done = 0
    const finish = () => {
      done += 1
      if (done >= images.length) resolve()
    }
    images.forEach((img) => {
      if (img.complete) return finish()
      img.addEventListener('load', finish, { once: true })
      img.addEventListener('error', finish, { once: true })
    })
    setTimeout(resolve, timeout)
  })

// ── 二维码（本地生成，内容为分享网页链接） ──

let qrLibPromise = null

const ensureQrLib = (ctx) => {
  if (window.qrcode) return Promise.resolve(true)
  if (qrLibPromise) return qrLibPromise
  qrLibPromise = (async () => {
    const pluginRoot = await ctx.electron.plugins.getDirectory()
    if (!pluginRoot) throw new Error('无法获取插件根目录')
    const libPath = `${String(pluginRoot).replace(/[\\/]+$/, '')}/${ctx.id}/vendor/qrcode-generator.js`
    const asset = await ctx.fs.readTextFile(libPath)
    if (!asset?.ok) throw new Error(`读取二维码库失败：${asset?.error || '未知错误'}`)
    // 兼容库的多种挂载方式：全局 qrcode / window.qrcode / this 挂载
    const factory = new Function(`${asset.content}\n;return (typeof qrcode !== 'undefined' ? qrcode : (window && window.qrcode))`)
    const lib = factory.call(window)
    if (lib) window.qrcode = lib
    return Boolean(window.qrcode)
  })()
  return qrLibPromise
}

const buildQrSvg = (url) => {
  const qrcode = window.qrcode
  if (!qrcode || !url) return ''
  try {
    const qr = qrcode(0, 'M')
    qr.addData(url)
    qr.make()
    return qr
      .createSvgTag({ cellSize: 4, margin: 0, scalable: true })
      .replace('<svg', '<svg preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%"')
  } catch {
    return ''
  }
}

// ── 歌曲数据解析（纯插件无主程序扩展点，从队列/当前播放/酷狗接口三层补齐数据） ──

const SONG_HASH_RE = /^[a-f0-9]{32}$/i

const buildSongShareUrl = (hash) =>
  `https://hoowhoami.github.io/EchoMusic/share/?type=song&id=${encodeURIComponent(String(hash))}`

/** 从分享文本（文案 + 链接）中解析歌曲分享目标：{hash, title, url} | null */
const parseSongShareText = (text) => {
  const raw = String(text || '')
  const urlMatch = raw.match(/https?:\/\/[^\s<>"'`]+/i)
  if (urlMatch) {
    let url
    try {
      url = new URL(urlMatch[0])
    } catch {
      url = null
    }
    if (url) {
      const type = url.searchParams.get('type')
      const id = (url.searchParams.get('id') || '').trim()
      if (type === 'song' && SONG_HASH_RE.test(id)) {
        const titleMatch = raw.match(/「([^」]+)」/)
        return { hash: id, title: titleMatch ? titleMatch[1].trim() : '', url: urlMatch[0] }
      }
    }
  }
  return null
}

const pickText = (record, keys) => {
  for (const key of keys) {
    const value = record?.[key]
    const text = value == null ? '' : String(value).trim()
    if (text) return text
  }
  return ''
}

const pickNumber = (record, keys) => {
  for (const key of keys) {
    const num = Number(record?.[key])
    if (Number.isFinite(num) && num > 0) return num
  }
  return 0
}

// 封面 URL 归一化（与主程序 normalizeCoverUrl/formatPic 同规则）
const normalizeCover = (raw) => {
  const text = String(raw || '').trim()
  if (!text) return ''
  let pic = text.replaceAll('{size}', '400')
  if (pic.startsWith('//')) pic = `https:${pic}`
  return pic.replace('http://', 'https://').replace('c1.kgimg.com', 'imge.kugou.com')
}

// 酷狗原始歌曲记录 → 卡片渲染数据（字段优先级参考主程序 mapper，宽松提取）
const normalizeMetaRecord = (record) => {
  if (!record || typeof record !== 'object') return null
  const audioInfo = record.audio_info && typeof record.audio_info === 'object' ? record.audio_info : {}
  const transParam = record.trans_param && typeof record.trans_param === 'object' ? record.trans_param : {}
  const merged = { ...audioInfo, ...transParam, ...record }

  let name = pickText(merged, ['songname', 'audio_name', 'name', 'filename', 'ori_audio_name'])
  let artist = pickText(merged, ['author_name', 'singername', 'singer', 'AuthorName'])
  if (!artist && name.includes(' - ')) artist = name.split(' - ')[0]
  if (name.includes(' - ')) name = name.split(' - ').slice(1).join(' - ')

  const durationSec = pickNumber(merged, ['time_length', 'duration'])
  const durationMs = pickNumber(merged, ['timelength', 'duration_128'])
  return {
    title: name,
    artist,
    album: pickText(merged, ['album_name', 'albumname', 'AlbumName']),
    coverUrl: normalizeCover(
      pickText(merged, ['album_sizable_cover', 'sizable_cover', 'cover', 'pic', 'img', 'imgurl', 'image']),
    ),
    duration: durationSec || Math.floor(durationMs / 1000),
  }
}

// 在嵌套响应里找含 hash 的歌曲数组（与主程序 findSongArray 同策略）
const findSongArray = (value, depth = 0) => {
  if (depth > 5) return []
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === 'object' && pickText(item, ['hash', 'file_hash', 'audio_hash']))) {
      return value
    }
    for (const item of value) {
      const nested = findSongArray(item, depth + 1)
      if (nested.length) return nested
    }
    return []
  }
  if (!value || typeof value !== 'object') return []
  for (const key of ['list', 'songs', 'audios', 'song_info', 'songs_info', 'audio_list', 'music_list', 'data', 'info']) {
    if (key in value) {
      const nested = findSongArray(value[key], depth + 1)
      if (nested.length) return nested
    }
  }
  return []
}

/**
 * 按 hash 三层查找歌曲渲染数据：
 * 1) 当前播放曲目 2) 播放队列 3) 酷狗 /audio 元信息接口
 */
const resolveSongData = async (ctx, hash) => {
  const hashText = String(hash || '').trim().toLowerCase()

  const matchesHash = (song) => {
    const candidates = [song?.hash, song?.originalHash, song?.id]
    return candidates.some((value) => String(value || '').trim().toLowerCase() === hashText)
  }

  const current = ctx.player?.currentTrack?.value || ctx.stores?.player?.currentTrackSnapshot
  if (current && matchesHash(current)) return current

  try {
    const queueSongs = await ctx.playlist?.getQueueSongs?.()
    const inQueue = (Array.isArray(queueSongs) ? queueSongs : []).find(matchesHash)
    if (inQueue) return inQueue
  } catch {
    // 队列不可用则继续走接口
  }

  try {
    const payload = await ctx.kugou?.music?.getAudioMetadata?.([hashText])
    let value = payload
    for (let i = 0; i < 5 && value && typeof value === 'object' && !Array.isArray(value) && 'data' in value; i += 1) {
      value = value.data
    }
    const list = findSongArray(value)
    const matched = list.find((item) =>
      [item?.hash, item?.hash_128, item?.file_hash, item?.original_hash].some(
        (value2) => String(value2 || '').trim().toLowerCase() === hashText,
      ),
    )
    const meta = normalizeMetaRecord(matched)
    if (meta && (meta.coverUrl || meta.artist || meta.title)) return meta
  } catch (error) {
    console.warn('[music-card-share] 酷狗元信息查询失败', error)
  }

  return null
}

// ── 卡片数据 ──

/**
 * 歌名统一过滤：剥掉「任意文本 - 」前缀只保留后缀（与主程序 processSongTitle 同规则）。
 * 完整示例：`海市蜃楼 - 三叔说` → `三叔说`；无 ` - ` 分隔或仅剩一段时不处理。
 */
const stripTitlePrefix = (title) => {
  const text = String(title || '').trim()
  if (text.includes(' - ')) {
    const parts = text.split(' - ')
    if (parts.length > 1) {
      const rest = parts.slice(1).join(' - ').trim()
      if (rest) return rest
    }
  }
  return text
}

const buildCardData = (songLike, fallbackTitle, url) => {
  const source = songLike || {}
  const rawTitle = String(source.title || source.name || fallbackTitle || '').trim()
  const name = stripTitlePrefix(rawTitle) || '未知歌曲'
  let artist = String(source.artist || '').trim()
  // 歌手缺失且原始歌名带「歌手 - 」前缀时，将被剥掉的前缀补作歌手
  if (!artist && name !== rawTitle) artist = rawTitle.split(' - ')[0].trim()
  artist = artist || '未知歌手'
  const album = String(source.albumName || source.album || '').trim()
  const coverUrl = String(source.coverUrl || source.cover || '').trim()
  const duration = Math.max(0, Number(source.duration) || 0)
  // 装饰性播放进度（静态分享图取 42%）
  const progress = 0.42
  return {
    name,
    artist,
    album,
    coverUrl,
    duration,
    progress,
    playedText: formatDuration(duration * progress),
    remainText: `-${formatDuration(duration * (1 - progress))}`,
    qrSvg: buildQrSvg(url),
    dateText: formatToday(),
    snippet: String(source.lyricSnippet || '').trim(),
  }
}

const coverStyle = (data, extra = '') => {
  const fallback = 'linear-gradient(135deg,#3d4460,#232637)'
  // 注意：输出用于内联 style 属性，URL 必须用单引号，避免与属性双引号嵌套截断
  const image = data.coverUrl ? `url('${escapeHtml(data.coverUrl)}') center/cover no-repeat` : fallback
  return `background:${image};${extra}`
}

const coverImg = (data, className) =>
  data.coverUrl
    ? `<img class="${className}" src="${escapeHtml(data.coverUrl)}" referrerpolicy="no-referrer" alt="">`
    : `<div class="${className}" style="${coverStyle(data)}"></div>`

// 底部品牌行（酷狗同款：二维码 + 品牌名 + 引导文案）
const brandHtml = (data) => `
  <div class="brand">
    ${data.qrSvg ? `<div class="brand-qr">${data.qrSvg}</div>` : ''}
    <div class="brand-text">
      <div class="brand-name">EchoMusic</div>
      <div class="brand-tip">长按识别可播放歌曲</div>
    </div>
  </div>`

const textEllipsis = 'overflow:hidden;white-space:nowrap;text-overflow:ellipsis;'

// ── 卡片模板注册器 ──
// 模板以目录形式注册：template/<模板名>/index.js 为入口（CommonJS 风格 module.exports），
// 插件每次打开弹窗时自动扫描 template/ 目录发现并加载模板。
// 模板目录约定：
//   index.js   必需，导出 { id, name, html(data), async init?(ctx) }
//     - id    模板唯一标识
//     - name  弹窗里显示的名称
//     - html(data)  同步返回卡片 HTML 字符串；根元素必须为 .mcsg-card，
//                   尺寸自定（默认约定 750×1000，酷狗同款模板为 720×1146），
//                   弹窗预览/缩略图与截图导出均按实际尺寸自适应
//     - init(ctx)   可选异步初始化，用于加载自身资源；抛错则该模板被跳过
//       ctx.loadText(rel)       读模板目录内文本资源（css/html/js/json…）
//       ctx.loadDataURL(rel)    读模板目录内二进制资源转 dataURL（png/jpg/woff…）
//       ctx.helpers             宿主共享工具（escapeHtml/brandHtml/eraseImageRegion/echoBrandHtml…）
//   其余文件   模板自己的 css/html/图片/字体等资源，经 init 加载
// 数据契约：html(data) 的 data 字段见 buildCardData（name/artist/album/coverUrl/duration/qrSvg…）

const CARD_SIZE = { width: CARD_WIDTH, height: CARD_HEIGHT }

// 加载图片（dataURL/网络 URL 均可，dataURL 不受 CORS 限制可安全导出）
const loadImageFromUrl = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })

/**
 * 擦除图片指定区域：用区域正上方的取样条向下拉伸覆盖（适配渐变/纯色背景）。
 * 用于清除酷狗官方前景素材中固化的"酷狗音乐"品牌行（各款位置不同由模板传入）。
 */
const eraseImageRegion = async (dataUrl, rect) => {
  const img = await loadImageFromUrl(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const c2d = canvas.getContext('2d')
  c2d.drawImage(img, 0, 0)
  const { x, y, w, h, sampleH = 44 } = rect
  c2d.drawImage(canvas, x, y - sampleH, w, sampleH, x, y, w, h)
  return canvas.toDataURL('image/png')
}

/**
 * EchoMusic 品牌行（替换酷狗前景图中固化的品牌行位置）。
 * tone: 'light' 深色底白字 | 'dark' 浅色底黑字
 */
const echoBrandHtml = (left, top, tone = 'light') => {
  const main = tone === 'light' ? '#ffffff' : '#26272e'
  const sub = tone === 'light' ? 'rgba(255,255,255,.68)' : 'rgba(20,22,30,.55)'
  const logoBg = tone === 'light' ? '#ffffff' : '#26272e'
  const logoColor = tone === 'light' ? '#17181c' : '#ffffff'
  return `<div style="position:absolute;left:${left}px;top:${top}px;display:flex;flex-direction:column;align-items:flex-start;gap:10px">
    <div style="display:flex;align-items:center;gap:12px">
      <span style="width:42px;height:42px;border-radius:13px;background:${logoBg};color:${logoColor};font:800 25px/42px 'Segoe UI','PingFang SC',sans-serif;text-align:center">E</span>
      <span style="color:${main};font-size:31px;font-weight:800;letter-spacing:1px">EchoMusic</span>
    </div>
    <span style="color:${sub};font-size:24px">长按识别可播放歌曲</span>
  </div>`
}

/**
 * 酷狗 json_str 模板的文本元素渲染（对应 tv_song_name / tv_singer_name / tv_listen_count）。
 * 坐标/字号/颜色直接取自接口 json_str 的元素描述；left 为 null 时按整宽居中（gravity:center）。
 */
const kugouTextHtml = ({ left, top, size, color = '#ffffff', alpha = 1, align = 'left', width = 0, bold = true, text }) => {
  const style = [
    'position:absolute',
    `top:${top}px`,
    'line-height:1.3',
    `font-size:${size}px`,
    `color:${color}`,
    alpha < 1 ? `opacity:${alpha}` : '',
    `text-align:${align}`,
    `font-weight:${bold ? 800 : 400}`,
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis',
    left == null ? 'left:0;width:100%' : `left:${left}px`,
    width ? `width:${width}px` : '',
  ].filter(Boolean).join(';')
  return `<div style="${style}">${escapeHtml(String(text ?? ''))}</div>`
}

/** 酷狗 json_str 模板的二维码元素渲染（白底圆角块内嵌本地生成的 SVG 码） */
const kugouQrHtml = (left, top, svg, size = 88) =>
  `<div style="position:absolute;left:${left}px;top:${top}px;width:${size}px;height:${size}px;background:#fff;border-radius:10px;padding:5px;box-sizing:border-box">${svg}</div>`

// 注入模板的共享工具集
const buildTemplateHelpers = () => ({
  escapeHtml,
  formatDuration,
  textEllipsis,
  coverStyle,
  coverImg,
  brandHtml,
  loadImageFromUrl,
  eraseImageRegion,
  echoBrandHtml,
  kugouTextHtml,
  kugouQrHtml,
  CARD_SIZE,
})

// 构造单个模板的加载上下文（资源路径限制在模板目录内）
const createTemplateContext = (ctx, templateDir, helpers) => {
  const resolvePath = (relativePath) => {
    const rel = String(relativePath || '').replace(/^[\\/]+/, '')
    if (!rel || rel.includes('..')) throw new Error(`非法资源路径：${relativePath}`)
    return `${templateDir}/${rel}`
  }
  return {
    helpers,
    plugin: ctx,
    loadText: async (relativePath) => {
      const asset = await ctx.fs.readTextFile(resolvePath(relativePath))
      if (!asset?.ok) throw new Error(`读取资源失败：${asset?.error || relativePath}`)
      return asset.content
    },
    loadDataURL: async (relativePath) => {
      const bytes = await ctx.fs.readFileBytes(resolvePath(relativePath))
      if (!bytes?.ok) throw new Error(`读取资源失败：${bytes?.error || relativePath}`)
      const data = bytes.data ?? bytes.content
      const buffer = typeof data === 'string' ? Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)) : new Uint8Array(data)
      let binary = ''
      for (let i = 0; i < buffer.length; i += 1) binary += String.fromCharCode(buffer[i])
      const base64 = btoa(binary)
      const extension = (String(relativePath).split('.').pop() || 'png').toLowerCase()
      const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf' }
      return `data:${mimeMap[extension] || 'application/octet-stream'};base64,${base64}`
    },
  }
}

// 扫描 template/ 目录，加载全部可用模板（单个模板失败只跳过不影响其他）
const discoverTemplates = async (ctx) => {
  const pluginRoot = String(await ctx.electron.plugins.getDirectory() || '').replace(/[\\/]+$/, '')
  if (!pluginRoot) {
    console.warn('[music-card-share] 无法获取插件根目录，模板扫描跳过')
    return []
  }
  const templateRoot = `${pluginRoot}/${ctx.id}/template`

  let entries = []
  try {
    const scan = await ctx.fs.listFiles(templateRoot, { recursive: true, kinds: ['other', 'image'] })
    if (scan?.ok) entries = Array.isArray(scan.files) ? scan.files : []
    else if (scan && !scan.ok) console.warn('[music-card-share] 模板目录扫描失败：', scan.error || '未知错误')
  } catch (error) {
    console.warn('[music-card-share] 模板目录扫描异常', error)
  }

  // 以目录下的 index.js 推断模板目录（listFiles 只返回文件不返回目录）
  const templateDirs = new Set()
  for (const entry of entries) {
    const relative = String(entry?.relativePath || '').replace(/\\/g, '/')
    const match = relative.match(/^(.+)\/index\.js$/i)
    if (match && match[1] && !match[1].includes('/')) templateDirs.add(match[1])
  }
  if (templateDirs.size === 0) {
    console.warn('[music-card-share] template/ 下未发现任何模板（每个模板需 <目录名>/index.js）')
    return []
  }

  const helpers = buildTemplateHelpers()
  const templates = []
  for (const dirName of templateDirs) {
    const templateDir = `${templateRoot}/${dirName}`
    try {
      const source = await ctx.fs.readTextFile(`${templateDir}/index.js`)
      if (!source?.ok) throw new Error(source?.error || '读取 index.js 失败')
      // 以 CommonJS 形式执行模板入口：module.exports 暴露模板定义
      const module = { exports: {} }
      const loader = new Function('module', 'exports', 'ctx', String(source.content))
      loader(module, module.exports, createTemplateContext(ctx, templateDir, helpers))
      const definition = module.exports
      if (!definition || typeof definition !== 'object') throw new Error('模板未导出定义对象')
      if (!definition.id || typeof definition.id !== 'string') throw new Error('模板缺少字符串 id')
      if (typeof definition.html !== 'function') throw new Error('模板缺少 html(data) 渲染函数')

      definition.helpers = helpers
      definition.dirName = dirName
      definition.name = String(definition.name || definition.id)
      if (typeof definition.init === 'function') {
        await definition.init(createTemplateContext(ctx, templateDir, helpers))
      }
      templates.push(definition)
    } catch (error) {
      console.warn(`[music-card-share] 模板加载失败（跳过）：${dirName}`, error)
    }
  }
  return templates
}

// ── 截图导出（stage 模式：短暂可见的高清离屏卡片 → capturePage） ──

const buildCaptureStage = (cardHtml) => {
  const stage = document.createElement('div')
  stage.setAttribute('data-mcsg-stage', '1')
  // 尺寸由卡片模板根元素（.mcsg-card）自身决定，stage 只负责定位与显隐
  stage.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'z-index:2147483647',
    'visibility:hidden',
    'pointer-events:none',
  ].join(';')
  stage.innerHTML = cardHtml
  return stage
}

const captureStageRect = (stage) => {
  const card = stage.querySelector('.mcsg-card')
  const rect = (card || stage).getBoundingClientRect()
  return {
    x: Math.max(0, Math.floor(rect.left)),
    y: Math.max(0, Math.floor(rect.top)),
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
  }
}

/**
 * 导出当前卡片到剪贴板（主进程 capturePage → clipboard.writeImage）
 * 短暂显示离屏 stage 后截图，History.vue 听歌统计分享同款节奏
 */
const exportCardImage = async (cardHtml) => {
  const capture = window.electron?.share?.captureRectToClipboard
  if (!capture) throw new Error('当前客户端不支持截图复制')

  const stage = buildCaptureStage(cardHtml)
  document.body.appendChild(stage)
  try {
    await waitForImages(stage)
    // 先隐藏加载图片，再短暂显示两帧等待合成器绘制
    stage.style.visibility = 'visible'
    await nextPaint()
    const rect = captureStageRect(stage)
    const ok = await capture(rect)
    if (!ok) throw new Error('复制分享图片失败')
  } finally {
    stage.remove()
  }
}

// ── 分享弹窗 ──

const DIALOG_STYLE_ID = 'mcsg-dialog-style'

const ensureDialogStyles = () => {
  if (document.getElementById(DIALOG_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = DIALOG_STYLE_ID
  style.textContent = `
.mcsg-ui-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(8,9,14,.52);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center}
.mcsg-ui-dialog{width:880px;max-width:calc(100vw - 48px);max-height:calc(100vh - 48px);border-radius:22px;background:var(--color-bg-main,#1b1c22);box-shadow:0 40px 120px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden}
.mcsg-ui-header{display:flex;align-items:center;gap:14px;padding:20px 24px;border-bottom:1px solid rgba(128,128,140,.14)}
.mcsg-ui-title{color:var(--color-text-main,#ececf2);font-size:19px;font-weight:700}
.mcsg-ui-sub{flex:1;min-width:0;color:var(--color-text-secondary,#9a9ca8);font-size:13px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.mcsg-ui-close{flex:0 0 auto;width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--color-text-secondary,#9a9ca8);font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.mcsg-ui-close:hover{background:rgba(128,128,140,.16);color:var(--color-text-main,#ececf2)}
.mcsg-ui-body{display:flex;gap:22px;padding:22px 24px;overflow:auto}
.mcsg-ui-preview{flex:0 0 auto;width:452px}
.mcsg-ui-preview-clip{width:452px;border-radius:16px;overflow:hidden;background:#101116;box-shadow:0 14px 40px rgba(0,0,0,.32)}
.mcsg-ui-preview-card{transform-origin:top left}
.mcsg-ui-preview-hint{margin-top:10px;text-align:center;color:var(--color-text-secondary,#9a9ca8);font-size:12px}
.mcsg-ui-side{flex:1;min-width:0;display:flex;flex-direction:column}
.mcsg-ui-grid{display:grid;grid-template-columns:repeat(3,100px);gap:12px;justify-content:start}
.mcsg-ui-style{position:relative;border:2px solid transparent;border-radius:12px;overflow:hidden;cursor:pointer;background:#101116;padding:0;outline:none}
.mcsg-ui-style.is-active{border-color:#4a8cff;box-shadow:0 0 0 3px rgba(74,140,255,.22)}
.mcsg-ui-style-clip{width:100px;position:relative}
.mcsg-ui-style-card{position:absolute;left:0;top:0;transform-origin:top left;pointer-events:none}
.mcsg-ui-style-name{position:absolute;left:0;right:0;bottom:0;padding:14px 0 5px;text-align:center;color:#fff;font-size:12px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.72))}
.mcsg-ui-actions{margin-top:auto;padding-top:18px;display:flex;flex-direction:column;gap:10px}
.mcsg-ui-btn{height:42px;border-radius:11px;border:1px solid rgba(128,128,140,.3);background:transparent;color:var(--color-text-main,#ececf2);font-size:14px;cursor:pointer;transition:background .15s}
.mcsg-ui-btn:hover{background:rgba(128,128,140,.14)}
.mcsg-ui-btn.is-primary{border:0;background:#4a8cff;color:#fff;font-weight:600}
.mcsg-ui-btn.is-primary:hover{background:#3b7def}
.mcsg-ui-btn:disabled{opacity:.55;cursor:not-allowed}
`
  document.head.appendChild(style)
}

const createShareDialog = (ctx, shareContext, closeDialog) => {
  const { defineComponent, h, ref, onMounted, onBeforeUnmount } = ctx.vue
  // 本次分享可用的模板列表（由模板发现器扫描 template/ 目录得到）
  const templates = Array.isArray(shareContext.templates) ? shareContext.templates : []

  return defineComponent({
    name: 'MusicCardShareDialog',
    setup() {
      const currentId = ref(templates[0]?.id || '')
      const busy = ref('')
      const previewRef = ref(null)
      let disposed = false

      const data = buildCardData(shareContext.songLike, shareContext.title, shareContext.url)
      const templateOf = (id) => templates.find((item) => item.id === id) || templates[0]
      const cardHtmlOf = (id) => templateOf(id).html(data)

      // 读取卡片根元素实际尺寸（各模板尺寸可不同，酷狗同款为 720×1146）
      const measureCard = (root) => {
        const card = root?.querySelector('.mcsg-card')
        return {
          width: card?.offsetWidth || CARD_WIDTH,
          height: card?.offsetHeight || CARD_HEIGHT,
        }
      }

      // 预览区自适应：按容器可用空间等比缩放，clip 容器贴合缩放后尺寸
      const injectPreview = () => {
        const holder = previewRef.value
        if (!holder) return
        holder.innerHTML = cardHtmlOf(currentId.value)
        const { width, height } = measureCard(holder)
        const scale = Math.min(452 / width, 596 / height)
        holder.style.width = `${width}px`
        holder.style.height = `${height}px`
        holder.style.transform = `scale(${scale})`
        const clip = holder.parentElement
        clip.style.width = `${Math.round(width * scale)}px`
        clip.style.height = `${Math.round(height * scale)}px`
      }

      // 缩略图自适应：统一按 100px 列宽等比缩放
      const injectThumbs = () => {
        document.querySelectorAll('[data-mcsg-thumb]').forEach((node) => {
          const id = node.getAttribute('data-mcsg-thumb')
          const holder = node.querySelector('.mcsg-ui-style-card')
          if (!holder) return
          holder.innerHTML = cardHtmlOf(id)
          const { width, height } = measureCard(holder)
          const scale = 100 / width
          holder.style.width = `${width}px`
          holder.style.height = `${height}px`
          holder.style.transform = `scale(${scale})`
          const clip = node.querySelector('.mcsg-ui-style-clip')
          if (clip) clip.style.height = `${Math.round(height * scale)}px`
        })
      }

      onMounted(() => {
        injectThumbs()
        injectPreview()
      })
      onBeforeUnmount(() => {
        disposed = true
      })

      const close = () => closeDialog?.()

      const selectStyle = (id) => {
        if (busy.value) return
        currentId.value = id
        injectPreview()
      }

      const exportImage = async () => {
        if (busy.value) return
        busy.value = true
        try {
          await exportCardImage(cardHtmlOf(currentId.value))
          ctx.toast.success('分享图片已复制，去粘贴吧')
        } catch (error) {
          ctx.toast.warning(error instanceof Error ? error.message : '复制分享图片失败')
        } finally {
          if (!disposed) busy.value = false
        }
      }

      const copyLink = async () => {
        // 分享文本为空时（如命令入口）退化为仅复制链接
        const text = shareContext.text || shareContext.url
        try {
          if (window.electron?.share?.copy) await window.electron.share.copy(text)
          else await navigator.clipboard.writeText(text)
          ctx.toast.success('分享链接已复制')
        } catch {
          ctx.toast.warning('复制分享链接失败')
        }
      }

      return () =>
        h('div', {
          class: 'mcsg-ui-overlay',
          onClick: (event) => {
            if (event.target === event.currentTarget) close()
          },
        }, [
          h('div', { class: 'mcsg-ui-dialog' }, [
            h('div', { class: 'mcsg-ui-header' }, [
              h('span', { class: 'mcsg-ui-title' }, '分享歌曲卡片'),
              h('span', { class: 'mcsg-ui-sub' }, `${data.name} - ${data.artist}`),
              h('button', { class: 'mcsg-ui-close', onClick: close }, '✕'),
            ]),
            h('div', { class: 'mcsg-ui-body' }, [
              h('div', { class: 'mcsg-ui-preview' }, [
                h('div', { class: 'mcsg-ui-preview-clip' }, [
                  h('div', { class: 'mcsg-ui-preview-card', ref: previewRef }),
                ]),
                h('div', { class: 'mcsg-ui-preview-hint' }, '二维码可被「长按识别」打开分享页'),
              ]),
              h('div', { class: 'mcsg-ui-side' }, [
                h('div', { class: 'mcsg-ui-grid' },
                  templates.map((tpl) =>
                    h('button', {
                      key: tpl.id,
                      class: ['mcsg-ui-style', currentId.value === tpl.id ? 'is-active' : ''],
                      'data-mcsg-thumb': tpl.id,
                      onClick: () => selectStyle(tpl.id),
                    }, [
                      h('div', { class: 'mcsg-ui-style-clip' }, [
                        h('div', { class: 'mcsg-ui-style-card' }),
                      ]),
                      h('div', { class: 'mcsg-ui-style-name' }, tpl.name),
                    ]),
                  ),
                ),
                h('div', { class: 'mcsg-ui-actions' }, [
                  h('button', {
                    class: 'mcsg-ui-btn is-primary',
                    disabled: busy.value,
                    onClick: () => exportImage(),
                  }, busy.value ? '正在复制…' : '复制图片'),
                  h('button', {
                    class: 'mcsg-ui-btn',
                    disabled: busy.value,
                    onClick: copyLink,
                  }, '复制链接'),
                ]),
              ]),
            ]),
          ]),
        ])
    },
  })
}

// ── 激活入口 ──

export default async function activate(ctx) {
  let dialogDisposer = null
  let opening = false

  const closeDialog = () => {
    if (dialogDisposer) {
      const dispose = dialogDisposer
      dialogDisposer = null
      try {
        dispose()
      } catch {
        // 组件已卸载时忽略
      }
    }
  }

  const openShareDialog = async (shareContext) => {
    try {
      await ensureQrLib(ctx)
    } catch (error) {
      // 二维码库加载失败不阻断弹窗，卡片退化为无码样式
      console.warn('[music-card-share] 二维码库加载失败', error)
    }
    closeDialog()
    ensureDialogStyles()
    dialogDisposer = ctx.ui.teleport(createShareDialog(ctx, shareContext, closeDialog))
  }

  // 弹窗打开入口（去重：解析歌曲数据期间或弹窗已开时忽略重复触发）
  // 每次打开都重新扫描 template/ 目录，模板增删改无需重启插件
  const requestOpen = async (shareContext) => {
    if (opening || dialogDisposer) return
    opening = true
    try {
      const templates = await discoverTemplates(ctx)
      if (templates.length === 0) {
        ctx.toast.warning('未发现可用卡片模板，请检查插件 template/ 目录')
        return false
      }
      const songLike = await resolveSongData(ctx, shareContext.hash)
      await openShareDialog({ ...shareContext, songLike, templates })
      return true
    } finally {
      opening = false
    }
  }

  // 覆盖模式下移除主程序误弹的“分享链接已复制”（实际并未复制，由卡片弹窗接管）
  const suppressHostToast = () => {
    setTimeout(() => {
      try {
        const toastStore = ctx.pinia?._s?.get?.('toast')
        if (!toastStore?.items) return
        const index = toastStore.items.findIndex((item) => item.message === '分享链接已复制')
        if (index >= 0) toastStore.items.splice(index, 1)
      } catch {
        // 防御：toast 清理失败不影响主流程
      }
    }, 80)
  }

  // ── 接管层 1（首选）：覆盖 share.copy，歌曲分享不再复制链接，直接弹卡片弹窗 ──
  // contextBridge 暴露的对象属性可重新赋值（configurable: false 但 writable: true），
  // 仍以运行时探测为准；失败则降级到接管层 2。
  const installCopyPatch = () => {
    const share = window.electron?.share
    if (!share || typeof share.copy !== 'function') return null

    const originalCopy = share.copy
    const probe = () => true
    try {
      share.copy = probe
    } catch {
      return null
    }
    if (share.copy !== probe) return null

    const patchedCopy = async (text) => {
      const parsed = parseSongShareText(text)
      // 非歌曲分享（歌单/专辑/歌手/插件/一起听等）透传原始复制行为
      if (!parsed) return originalCopy(text)
      const opened = await requestOpen({ ...parsed, text })
      // 无可用模板时回退原始复制链接行为
      if (!opened) return originalCopy(text)
      suppressHostToast()
      ctx.toast.info('已打开卡片分享，选择你喜欢的样式吧')
      return true
    }
    share.copy = patchedCopy
    return () => {
      try {
        share.copy = originalCopy
      } catch {
        // 还原失败不影响卸载
      }
    }
  }

  // ── 接管层 2（降级）：copy 不可覆盖时监听分享完成事件，事后弹出卡片弹窗 ──
  // 此时主程序默认的“复制链接”已执行，弹窗内“复制图片”会覆盖剪贴板，
  // 直接关闭弹窗则保留链接（等于原始分享行为，无损降级）。
  const installEventFallback = () => {
    const handler = (event) => {
      const detail = event.detail || {}
      const hash = String(detail.target?.id || '').trim()
      if (detail.target?.type !== 'song' || !SONG_HASH_RE.test(hash)) return
      const parsed = parseSongShareText(String(detail.text || ''))
      void requestOpen({
        hash,
        title: String(detail.target?.title || '').trim(),
        url: parsed?.url || buildSongShareUrl(hash),
        text: String(detail.text || ''),
      })
    }
    window.addEventListener('echomusic:share-copied', handler)
    return () => window.removeEventListener('echomusic:share-copied', handler)
  }

  const restoreCopy = installCopyPatch()
  if (restoreCopy) {
    ctx.dispose(restoreCopy)
  } else {
    console.warn('[music-card-share] share.copy 不可覆盖，降级为分享后弹窗模式')
    const removeFallback = installEventFallback()
    if (removeFallback) ctx.dispose(removeFallback)
  }

  // 命令入口：分享当前播放歌曲的卡片
  ctx.commands.register('share-current-card', () => {
    const track = ctx.player?.currentTrack?.value || ctx.stores?.player?.currentTrackSnapshot
    const hash = String(track?.hash || '').trim()
    if (!SONG_HASH_RE.test(hash)) {
      ctx.toast.warning('当前没有正在播放的歌曲')
      return
    }
    void requestOpen({
      hash,
      title: String(track.title || track.name || '').trim(),
      url: buildSongShareUrl(hash),
      text: '',
    })
  }, { title: '分享当前歌曲卡片' })
}
