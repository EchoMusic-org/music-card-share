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

// 复制链接/分享文案用主程序自有分享页（保持主程序原有行为）
const buildSongShareUrl = (hash) =>
  `https://hoowhoami.github.io/EchoMusic/share/?type=song&id=${encodeURIComponent(String(hash))}`

// 卡片二维码用酷狗官方分享活动页（与官方歌曲卡片二维码同款）；album_audio_id 缺失时仅带 hash
const buildSongQrUrl = (hash, albumAudioId) => {
  const params = new URLSearchParams()
  params.set('hash', String(hash))
  const audioId = String(albumAudioId ?? '').trim()
  if (audioId && Number.isFinite(Number(audioId)) && Number(audioId) > 0) {
    params.set('album_audio_id', audioId)
  }
  return `https://h5.kugou.com/v2/v-5a15aeb1/index.html?${params.toString()}`
}

// 从歌曲数据中提取酷狗 album_audio_id（混合曲目 ID）：
// 主程序歌曲对象用 camelCase（albumAudioId/mixSongId），酷狗接口原始记录用 snake_case
const pickAlbumAudioId = (source) => {
  const record = source || {}
  const candidates = [record.albumAudioId, record.mixSongId, record.album_audio_id, record.mixsongid]
  for (const value of candidates) {
    const num = Number(value)
    if (Number.isFinite(num) && num > 0) return String(num)
  }
  return ''
}

/** 从分享文本（文案 + 链接）中解析歌曲分享目标：{hash, title, url, albumAudioId?} | null */
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
      const titleMatch = raw.match(/「([^」]+)」/)
      const title = titleMatch ? titleMatch[1].trim() : ''
      // 主程序自有分享页：type=song&id=<hash>
      const type = url.searchParams.get('type')
      const id = (url.searchParams.get('id') || '').trim()
      if (type === 'song' && SONG_HASH_RE.test(id)) {
        return { hash: id, title, url: urlMatch[0] }
      }
      // 酷狗官方分享活动页：hash=<hash>&album_audio_id=...
      const hash = (url.searchParams.get('hash') || '').trim()
      if (url.hostname.endsWith('kugou.com') && SONG_HASH_RE.test(hash)) {
        const audioId = (url.searchParams.get('album_audio_id') || '').trim()
        return { hash, title, url: urlMatch[0], ...(audioId ? { albumAudioId: audioId } : {}) }
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
  const info = record.info && typeof record.info === 'object' ? record.info : {}
  const audioInfo = record.audio_info && typeof record.audio_info === 'object' ? record.audio_info : {}
  const albumInfo = record.album_info && typeof record.album_info === 'object' ? record.album_info : {}
  const transParam = record.trans_param && typeof record.trans_param === 'object' ? record.trans_param : {}
  const merged = { ...info, ...albumInfo, ...audioInfo, ...transParam, ...record }

  let name = pickText(merged, ['songname', 'audio_name', 'name', 'filename', 'ori_audio_name'])
  let artist = pickText(merged, ['author_name', 'singername', 'singer', 'AuthorName'])
  if (!artist && name.includes(' - ')) artist = name.split(' - ')[0]
  if (name.includes(' - ')) name = name.split(' - ').slice(1).join(' - ')

  // 封面分散在不同层级，按主程序 buildSongFromPrivilege / parseTrackMetadataFromPrivilege 的路径回退：
  // 顶层 album_sizable_cover / sizable_cover / pic / img，record.info.image / img，
  // record.album_info.sizable_cover / cover，record.trans_param.union_cover
  const coverRaw = pickText(merged, ['album_sizable_cover', 'sizable_cover', 'cover', 'pic', 'imgurl', 'img', 'image'])
    || pickText(info, ['image', 'img'])
    || pickText(albumInfo, ['sizable_cover', 'cover', 'pic', 'img'])
    || pickText(transParam, ['union_cover'])

  const durationSec = pickNumber(merged, ['time_length', 'duration'])
  const durationMs = pickNumber(merged, ['timelength', 'duration_128'])
  return {
    title: name,
    artist,
    album: pickText(merged, ['album_name', 'albumname', 'AlbumName']),
    coverUrl: normalizeCover(coverRaw),
    duration: durationSec || Math.floor(durationMs / 1000),
    albumAudioId: pickNumber(merged, ['album_audio_id', 'mixsongid']),
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

  // 以目录下的 index.js 推断模板目录
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

// ── 截图导出 ──
//
// 首选「插件内栅格化」：卡片 HTML → foreignObject SVG → canvas → PNG 写入剪贴板。
// 全程在渲染进程完成，尺寸由自己指定，因此分辨率与窗口大小、屏幕 DPI 无关；
// 代价是 SVG 图像里的 backdrop-filter 不生效（模板中的毛玻璃会退化为半透明底）。
// 该路失败时回退到「截预览区已渲染的卡片」——保真但分辨率受视口与屏幕 DPI 限制。

// 导出目标像素高度：按卡片逻辑尺寸等比放大到该高度
const EXPORT_TARGET_HEIGHT = 2048
// 放大倍数上限，避免超大画布占满内存
const EXPORT_MAX_RATIO = 3

/** ArrayBuffer → base64（分块拼接，避免 apply 参数过长） */
const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/**
 * 抓取远程资源为 dataURL。
 * 主窗口 webSecurity 关闭，ctx.net.fetch 不受 CORS 限制；
 * 酷狗封面有防盗链，必须不带 referrer（与模板里 img 的 referrerpolicy 一致）。
 */
const fetchAsDataUrl = async (ctx, url) => {
  const fetchImpl = ctx.net?.fetch || (typeof fetch === 'function' ? fetch.bind(window) : null)
  if (!fetchImpl) return ''
  try {
    const response = await fetchImpl(url, { referrerPolicy: 'no-referrer' })
    if (!response?.ok) return ''
    const buffer = await response.arrayBuffer()
    if (!buffer || buffer.byteLength === 0) return ''
    const mime = String(response.headers?.get?.('content-type') || '').split(';')[0].trim()
    return `data:${mime.startsWith('image/') ? mime : 'image/jpeg'};base64,${arrayBufferToBase64(buffer)}`
  } catch (error) {
    console.warn('[music-card-share] 图片内联失败：', url, error)
    return ''
  }
}

/**
 * 把卡片 HTML 里的远程图片（img 的 src 与样式里的 url()）内联成 dataURL，
 * 使栅格化文档完全自包含 —— SVG 图像不会加载外部资源。
 */
const inlineRemoteImages = async (ctx, html) => {
  let doc
  try {
    doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  } catch {
    return html
  }
  const body = doc?.body
  if (!body) return html

  const isRemote = (value) => /^(?:https?:)?\/\//i.test(String(value || ''))
  const targets = new Set()
  const collectFromStyleText = (text) => {
    if (!text) return
    const re = /url\(\s*['"]?((?:https?:)?\/\/[^'")]+)/gi
    let match = re.exec(text)
    while (match) {
      targets.add(match[1])
      match = re.exec(text)
    }
  }
  body.querySelectorAll('img[src]').forEach((el) => {
    const src = el.getAttribute('src')
    if (isRemote(src)) targets.add(src)
  })
  body.querySelectorAll('[style]').forEach((el) => collectFromStyleText(el.getAttribute('style')))
  body.querySelectorAll('style').forEach((el) => collectFromStyleText(el.textContent))
  if (targets.size === 0) return html

  const resolved = new Map()
  await Promise.all([...targets].map(async (url) => {
    const dataUrl = await fetchAsDataUrl(ctx, url)
    if (dataUrl) resolved.set(url, dataUrl)
  }))
  if (resolved.size === 0) return html

  const replaceUrls = (text) => {
    if (!text) return text
    let result = text
    resolved.forEach((dataUrl, url) => {
      result = result.split(url).join(dataUrl)
    })
    return result
  }
  body.querySelectorAll('img[src]').forEach((el) => {
    const src = el.getAttribute('src')
    if (src && resolved.has(src)) el.setAttribute('src', resolved.get(src))
  })
  body.querySelectorAll('[style]').forEach((el) => {
    el.setAttribute('style', replaceUrls(el.getAttribute('style')))
  })
  body.querySelectorAll('style').forEach((el) => {
    el.textContent = replaceUrls(el.textContent)
  })
  return body.innerHTML
}

/**
 * 卡片 HTML → PNG Blob（foreignObject 栅格化）。
 * viewBox 用卡片逻辑尺寸、SVG 输出尺寸用放大后的像素，等价于按更高像素密度重新渲染。
 */
const rasterizeCardToPng = async (ctx, cardHtml, cardWidth, cardHeight) => {
  const ratio = Math.min(EXPORT_MAX_RATIO, Math.max(1, EXPORT_TARGET_HEIGHT / cardHeight))
  const pixelWidth = Math.max(1, Math.round(cardWidth * ratio))
  const pixelHeight = Math.max(1, Math.round(cardHeight * ratio))

  const html = await inlineRemoteImages(ctx, cardHtml)
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head><meta charset="utf-8">`
      + `<style>html,body{margin:0;padding:0;background:transparent}</style>`
      + `</head><body>${html}</body></html>`,
    'text/html',
  )
  const xml = new XMLSerializer().serializeToString(doc.documentElement)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" `
    + `viewBox="0 0 ${cardWidth} ${cardHeight}">`
    + `<foreignObject x="0" y="0" width="${cardWidth}" height="${cardHeight}">${xml}</foreignObject></svg>`

  const image = await loadImageFromUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
  const canvas = document.createElement('canvas')
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(image, 0, 0, pixelWidth, pixelHeight)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  return { blob, width: pixelWidth, height: pixelHeight }
}

/**
 * 导出当前卡片到剪贴板，返回实际导出的像素尺寸。
 * 先尝试插件内高清栅格化（分辨率与窗口、屏幕无关）；
 * 失败或宿主不支持剪贴板写图时，回退到截取预览区已渲染的卡片（保真，但受屏幕分辨率限制）。
 */
const exportCardImage = async (ctx, cardRoot, cardHtml) => {
  const card = cardRoot?.querySelector?.('.mcsg-card') || cardRoot
  if (!card) throw new Error('未找到可截图的卡片')

  await waitForImages(card)

  // 1) 插件内栅格化：offsetWidth/Height 是卡片的逻辑尺寸（不受预览缩放影响）
  const cardWidth = card.offsetWidth || 0
  const cardHeight = card.offsetHeight || 0
  if (cardHtml && cardWidth > 0 && cardHeight > 0 && navigator.clipboard?.write) {
    try {
      const raster = await rasterizeCardToPng(ctx, cardHtml, cardWidth, cardHeight)
      if (raster) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': raster.blob })])
        return { width: raster.width, height: raster.height }
      }
    } catch (error) {
      console.warn('[music-card-share] 高清栅格化失败，回退为预览截图：', error)
    }
  }

  // 2) 回退：截预览区已渲染的卡片（所见即所得，分辨率取决于视口与屏幕 DPI）
  const capture = window.electron?.share?.captureRectToClipboard
  if (!capture) throw new Error('当前客户端不支持截图复制')

  const before = card.getBoundingClientRect()
  if (before.top < 0 || before.left < 0 || before.bottom > window.innerHeight || before.right > window.innerWidth) {
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    await nextPaint()
  }

  const rect = card.getBoundingClientRect()
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)
  if (width <= 0 || height <= 0) throw new Error('卡片尚未渲染完成，请稍后重试')
  if (height > window.innerHeight || width > window.innerWidth) {
    throw new Error('窗口太小，无法完整截取卡片，请放大窗口后重试')
  }
  const ok = await capture({
    x: Math.max(0, Math.floor(rect.left)),
    y: Math.max(0, Math.floor(rect.top)),
    width,
    height,
  })
  if (!ok) throw new Error('复制分享图片失败')
  return { width, height }
}

// ── 分享弹窗 ──

// 主程序原始的复制能力。接管生效后 share.copy / clipboard.writeText 都已被替换成开弹窗的逻辑，
// 弹窗内的“复制链接”只有用原函数才能真的写剪贴板。
let hostOriginalCopy = null
let hostWriteText = null

const DIALOG_STYLE_ID = 'mcsg-dialog-style'

// 弹窗样式文本单列成常量：供 ensureDialogStyles 每次打开时覆盖比对（见该函数注释）
const DIALOG_STYLE_TEXT = `
.mcsg-ui-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(8,9,14,.52);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center}
.mcsg-ui-dialog{width:880px;max-width:calc(100vw - 48px);max-height:calc(100vh - 48px);border-radius:22px;background:var(--color-bg-main,#1b1c22);box-shadow:0 40px 120px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden}
.mcsg-ui-header{display:flex;align-items:center;gap:14px;padding:20px 24px;border-bottom:1px solid rgba(128,128,140,.14)}
.mcsg-ui-title{color:var(--color-text-main,#ececf2);font-size:19px;font-weight:700}
.mcsg-ui-sub{flex:1;min-width:0;color:var(--color-text-secondary,#9a9ca8);font-size:13px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.mcsg-ui-close{flex:0 0 auto;width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--color-text-secondary,#9a9ca8);font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.mcsg-ui-close:hover{background:rgba(128,128,140,.16);color:var(--color-text-main,#ececf2)}
.mcsg-ui-body{flex:1 1 auto;min-height:0;display:flex;gap:22px;padding:22px 24px;overflow:auto}
.mcsg-ui-preview{flex:0 0 auto;width:452px}
.mcsg-ui-preview-clip{width:452px;border-radius:16px;overflow:hidden;background:#101116;box-shadow:0 14px 40px rgba(0,0,0,.32)}
.mcsg-ui-preview-card{transform-origin:top left}
.mcsg-ui-side{position:relative;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
/* padding-bottom 给悬浮按钮让出空间：网格滚到底时最后一行也不会压在按钮下面 */
.mcsg-ui-grid{flex:1 1 auto;min-height:0;overflow:auto;align-content:start;grid-auto-rows:max-content;padding-bottom:58px;display:grid;grid-template-columns:repeat(3,100px);gap:12px;justify-content:start}
.mcsg-ui-style{position:relative;border:2px solid transparent;border-radius:12px;overflow:hidden;cursor:pointer;background:#101116;padding:0;outline:none}
.mcsg-ui-style.is-active{border-color:#4a8cff;box-shadow:0 0 0 3px rgba(74,140,255,.22)}
.mcsg-ui-style-clip{width:100px;position:relative}
.mcsg-ui-style-card{position:absolute;left:0;top:0;transform-origin:top left;pointer-events:none}
.mcsg-ui-style-name{position:absolute;left:0;right:0;bottom:0;padding:14px 0 5px;text-align:center;color:#fff;font-size:12px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.72))}
/* 操作按钮脱离内容流悬浮在侧栏底部（宽度同侧栏，左右各半）：模板网格在它下层滚动，按钮位置始终不变 */
.mcsg-ui-actions{position:absolute;left:0;right:0;bottom:0;z-index:1;display:flex;gap:12px}
.mcsg-ui-actions .mcsg-ui-btn{flex:1 1 0;min-width:0;box-sizing:border-box}
/* 次要按钮用不透明实底（悬浮在缩略图之上，透明底会透出卡片导致文字难读）；
   底色由主题背景色向文字色混少量比例，深浅主题下都保持与背景有区分度的中性色 */
.mcsg-ui-btn{height:42px;border-radius:11px;border:1px solid rgba(128,128,140,.34);background:var(--color-bg-main,#1b1c22);background:color-mix(in srgb, var(--color-bg-main,#1b1c22) 84%, var(--color-text-main,#ececf2));color:var(--color-text-main,#ececf2);font-size:14px;cursor:pointer;transition:background .15s}
.mcsg-ui-btn:hover{background:color-mix(in srgb, var(--color-bg-main,#1b1c22) 72%, var(--color-text-main,#ececf2))}
/* 主按钮跟随主程序主题色：与主程序内置按钮同款变量组合（background=primary + color=on-primary） */
.mcsg-ui-btn.is-primary{border-color:transparent;background:var(--color-primary,#4a8cff);color:var(--color-on-primary,#fff);font-weight:600}
.mcsg-ui-btn.is-primary:hover{background:var(--color-primary-hover,#3b7def)}
.mcsg-ui-btn.is-primary:active{background:var(--color-primary-pressed,var(--color-primary-hover,#3b7def))}
.mcsg-ui-btn:disabled{opacity:.55;cursor:not-allowed}
`

const ensureDialogStyles = () => {
  let style = document.getElementById(DIALOG_STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = DIALOG_STYLE_ID
    document.head.appendChild(style)
  }
  // 始终重写内容：style 元素一旦注入就留在文档里，插件热更新后若沿用旧的样式表，
  // 新版本 CSS 永远不会生效（曾导致新版 JS 配旧版 CSS 的错乱布局）
  if (style.textContent !== DIALOG_STYLE_TEXT) style.textContent = DIALOG_STYLE_TEXT
}

const createShareDialog = (ctx, shareContext, closeDialog) => {
  const { defineComponent, h, ref, onMounted, onBeforeUnmount } = ctx.vue
  // 本次分享可用的模板列表（由模板发现器扫描 template/ 目录得到）
  const templates = Array.isArray(shareContext.templates) ? shareContext.templates : []

  return defineComponent({
    name: 'MusicCardShareDialog',
    setup() {
      const currentId = ref(templates[0]?.id || '')
      // 必须用布尔：Vue 对布尔属性把空字符串也判为真，'' 会让按钮一开始就 disabled
      const busy = ref(false)
      const previewRef = ref(null)
      let disposed = false

      const data = buildCardData(shareContext.songLike, shareContext.title, shareContext.qrUrl)
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
        const clip = holder.parentElement
        // 可用高度取内容区实测值（扣除内边距）：预览不溢出，内容区就不会整体滚动、按钮位置也就固定
        const bodyBox = clip?.closest('.mcsg-ui-body')
        const bodyStyle = bodyBox ? getComputedStyle(bodyBox) : null
        const verticalPadding = bodyStyle
          ? (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0)
          : 44
        const availableHeight = Math.max(200, (bodyBox?.clientHeight || 0) - verticalPadding)
        const availableWidth = clip?.parentElement?.offsetWidth || 452
        const scale = Math.min(availableWidth / width, availableHeight / height)
        holder.style.width = `${width}px`
        holder.style.height = `${height}px`
        holder.style.transform = `scale(${scale})`
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
          // 传入当前模板的卡片 HTML：高清路径用它自行栅格化，失败时回退截预览区
          const size = await exportCardImage(ctx, previewRef.value, cardHtmlOf(currentId.value))
          ctx.toast.success(size ? `分享图片已复制（${size.width}×${size.height}），去粘贴吧` : '分享图片已复制，去粘贴吧')
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
          // 优先用接管前保存的原函数：接管生效期间 share.copy / clipboard.writeText
          // 都已被替换成“打开弹窗”，直接调用会绕回接管逻辑而不是复制
          if (hostOriginalCopy) await hostOriginalCopy(text)
          else if (hostWriteText) await hostWriteText(text)
          else if (window.electron?.share?.copy) await window.electron.share.copy(text)
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
              // 左侧只放预览本身（容器尺寸由 injectPreview 按可用空间算好后贴合）
              h('div', { class: 'mcsg-ui-preview' }, [
                h('div', { class: 'mcsg-ui-preview-clip' }, [
                  h('div', { class: 'mcsg-ui-preview-card', ref: previewRef }),
                ]),
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
                  // 按钮悬浮在侧栏底部、浮于模板网格之上：左右各占一半，宽度即侧栏宽度
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
    // 清掉上一次会话残留的弹窗 DOM：插件热更新后旧实例已失联、新实例无法接管，
    // 不清理会在界面上叠出两套弹窗（旧按钮与旧布局仍在）
    document.querySelectorAll('.mcsg-ui-overlay').forEach((node) => node.remove())
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
      // 二维码单独用酷狗官方活动页链接（复制链接保持主程序原有分享页不变）：
      // album_audio_id 优先取歌曲数据，其次分享文本里自带的
      const qrUrl = buildSongQrUrl(shareContext.hash, pickAlbumAudioId(songLike) || shareContext.albumAudioId)
      await openShareDialog({ ...shareContext, qrUrl, songLike, templates })
      return true
    } finally {
      opening = false
    }
  }

  /**
   * 主程序在 copyShareTarget 之后会无条件弹「分享链接已复制」，而接管模式下并没有真复制。
   * 这里改写 toast store 的 actionCompleted：只吞掉被显式标记的那一条，其余提示照常显示；
   * 比“事后按文案删除”更干净——提示根本不会出现，也就没有一闪而过的残影。
   */
  const createShareToastGuard = () => {
    let pending = false
    try {
      const toastStore = ctx.pinia?._s?.get?.('toast')
      if (!toastStore || typeof toastStore.actionCompleted !== 'function') return null
      const original = toastStore.actionCompleted
      toastStore.actionCompleted = function patchedActionCompleted(message, ...rest) {
        if (pending && String(message ?? '').trim() === '分享链接已复制') {
          pending = false
          return undefined
        }
        return original.call(this, message, ...rest)
      }
      return {
        /** 声明“接下来那一条分享提示由接管吞掉” */
        expect: () => {
          pending = true
        },
        /** 回退到真复制时撤销吞掉标记，让提示正常出现 */
        cancel: () => {
          pending = false
        },
        dispose: () => {
          pending = false
          try {
            if (toastStore.actionCompleted !== original) toastStore.actionCompleted = original
          } catch {
            // 还原失败不影响卸载
          }
        },
      }
    } catch {
      return null
    }
  }

  // ── 接管层 1（首选）：覆盖 share.copy，歌曲分享不再复制链接，直接弹卡片弹窗 ──
  // 注意：Electron 的 contextBridge 把暴露属性定义为只读（writable/configurable 均为 false），
  // 这种情况下赋值会抛错，只能降级到接管层 2。
  // toast 拦截器两条接管路径共用
  const shareToastGuard = createShareToastGuard()

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

    // 接管期间 share.copy 已被替换，弹窗里的“复制链接”必须用这里保存的原函数
    hostOriginalCopy = originalCopy

    const patchedCopy = async (text) => {
      const parsed = parseSongShareText(text)
      // 非歌曲分享（歌单/专辑/歌手/插件/一起听等）透传原始复制行为
      if (!parsed) return originalCopy(text)
      // 预期主程序随后会弹「分享链接已复制」，先声明吞掉它
      shareToastGuard?.expect()
      const opened = await requestOpen({ ...parsed, text })
      if (!opened) {
        // 无可用模板时回退原始复制链接行为：既然真的复制了，提示就该正常出现
        shareToastGuard?.cancel()
        return originalCopy(text)
      }
      ctx.toast.info('已打开卡片分享，选择你喜欢的样式吧')
      return true
    }
    share.copy = patchedCopy
    return () => {
      hostOriginalCopy = null
      try {
        share.copy = originalCopy
      } catch {
        // 还原失败不影响卸载
      }
    }
  }

  // ── 兜底拦截：覆盖 navigator.clipboard.writeText（主程序只在 share.copy 缺失时才走它）──
  // 命中歌曲分享文本同样改为开卡片弹窗，不写剪贴板。
  const installClipboardFallback = () => {
    const clipboard = navigator.clipboard
    const originalWriteText = clipboard && typeof clipboard.writeText === 'function'
      ? clipboard.writeText.bind(clipboard)
      : null
    if (!originalWriteText) return null

    const patchedWriteText = async (text) => {
      const parsed = parseSongShareText(text)
      if (!parsed) return originalWriteText(text)
      shareToastGuard?.expect()
      const opened = await requestOpen({ ...parsed, text })
      if (!opened) {
        shareToastGuard?.cancel()
        return originalWriteText(text)
      }
      ctx.toast.info('已打开卡片分享，选择你喜欢的样式吧')
      return undefined
    }
    try {
      clipboard.writeText = patchedWriteText
    } catch {
      return null
    }
    if (clipboard.writeText !== patchedWriteText) return null
    hostWriteText = originalWriteText
    return () => {
      hostWriteText = null
      try {
        clipboard.writeText = originalWriteText
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

  // ── 接管层 0（点击劫持）：share.copy 只读时 API 层拦不住，改为在捕获阶段拦下分享点击 ──
  // 在捕获阶段停止传播，主程序自身的分享逻辑（复制链接 + 「分享链接已复制」提示）完全不会执行，
  // 直接由插件打开卡片弹窗。目标歌曲解析不出来时放行，保持主程序原行为（不会误伤非歌曲分享）。
  const installShareTriggerHijack = () => {
    // 最近一次右键命中的歌曲行：菜单项本身不带数据，靠它定位目标歌曲。
    // 行上只有 song.id；歌名/歌手文本用于在本地数据与搜索接口里兜底反查。
    let lastContextSong = { id: '', title: '', artist: '' }

    const rememberContextRow = (event) => {
      const row = event.target?.closest?.('[data-song-row]')
      lastContextSong = {
        id: String(row?.getAttribute?.('data-song-id') || ''),
        title: String(row?.querySelector?.('.song-title')?.textContent || '').trim(),
        artist: String(row?.querySelector?.('.song-artist')?.textContent || '').trim(),
      }
    }

    const isHashSong = (song) => Boolean(song) && SONG_HASH_RE.test(String(song.hash ?? ''))
    const readSongTitle = (song) => String(song?.name ?? song?.title ?? song?.songname ?? '').trim()

    // 在播放器/队列/主程序全部 store 里查找满足条件的歌曲对象
    // （右键的歌曲可能来自任意列表页，所以不能只查队列）
    const findSongInStores = (predicate) => {
      let budget = 6000
      const sources = []
      const push = (value) => {
        if (value) sources.push(value)
      }
      try { push(ctx.stores?.player?.currentTrack) } catch { /* 忽略不可读字段 */ }
      try { push(ctx.stores?.player?.queueSongs) } catch { /* 忽略不可读字段 */ }
      try { push(ctx.stores?.player?.playbackQueue) } catch { /* 忽略不可读字段 */ }
      try { push(ctx.playlist?.getQueueSongs?.()) } catch { /* 忽略不可读字段 */ }
      try {
        const stores = ctx.pinia?._s
        if (stores && typeof stores.forEach === 'function') stores.forEach((store) => push(store))
      } catch { /* 忽略不可读字段 */ }
      try { push(ctx.stores?.playlist) } catch { /* 忽略不可读字段 */ }

      const walk = (value, depth) => {
        if (!value || depth > 5 || budget <= 0) return null
        budget -= 1
        if (Array.isArray(value)) {
          for (const item of value) {
            const found = walk(item, depth + 1)
            if (found) return found
          }
          return null
        }
        if (typeof value !== 'object') return null
        if (predicate(value)) return value
        let keys = []
        try {
          keys = Object.keys(value)
        } catch {
          return null
        }
        for (const key of keys) {
          if (key.startsWith('__') || key === 'constructor') continue
          let descriptor = null
          try {
            descriptor = Object.getOwnPropertyDescriptor(value, key)
          } catch {
            continue
          }
          // 跳过 getter/computed/函数，避免触发计算或副作用
          if (!descriptor || descriptor.get || typeof descriptor.value === 'function') continue
          const found = walk(descriptor.value, depth + 1)
          if (found) return found
        }
        return null
      }
      for (const source of sources) {
        const found = walk(source, 0)
        if (found) return found
      }
      return null
    }

    const findSongById = (idText) => {
      if (!idText) return null
      return findSongInStores((song) => isHashSong(song) && String(song.id ?? '') === idText)
    }

    // 用行内的歌名/歌手在本地数据里匹配（收藏页等列表数据在组件内，不在 store 里时的兜底）
    const findSongByText = (title, artist) => {
      const targetTitle = String(title || '').trim().toLowerCase()
      if (!targetTitle) return null
      const targetArtist = String(artist || '').trim().toLowerCase()
      const listOf = (values) => values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
      return findSongInStores((song) => {
        if (!isHashSong(song)) return false
        if (!listOf([song.name, song.title, song.songname]).includes(targetTitle)) return false
        if (!targetArtist) return true
        const artists = listOf([song.artist, song.singername, song.author_name])
        return artists.some((item) => item.includes(targetArtist) || targetArtist.includes(item))
      })
    }

    // 收集响应里所有含 32 位 hash 的候选对象：搜索接口的响应结构不稳定，
    // 不猜字段名（lists/file_hash/SongName 等大小写与命名都变过），直接扫出来再按内容匹配
    const collectSongLikeObjects = (value, depth = 0, out = []) => {
      if (!value || depth > 6 || out.length > 300) return out
      if (Array.isArray(value)) {
        for (const item of value) collectSongLikeObjects(item, depth + 1, out)
        return out
      }
      if (typeof value !== 'object') return out
      out.push(value)
      let keys = []
      try {
        keys = Object.keys(value)
      } catch {
        return out
      }
      for (const key of keys) {
        const child = value[key]
        if (child && typeof child === 'object') collectSongLikeObjects(child, depth + 1, out)
      }
      return out
    }

    const pickFrom = (item, keys) => {
      for (const key of keys) {
        const value = item?.[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
      }
      return ''
    }

    // 本地都找不到时，用歌名+歌手走主程序搜索接口反查 hash
    const searchSongByText = async (title, artist) => {
      const keywords = [title, artist].filter(Boolean).join(' ').trim()
      if (!keywords) return null
      try {
        const payload = await ctx.kugou?.search?.search?.(keywords, 'song', 1, 10)
        const targetTitle = String(title || '').trim().toLowerCase()
        const targetArtist = String(artist || '').trim().toLowerCase()
        const hit = collectSongLikeObjects(payload).find((item) => {
          const hash = pickFrom(item, ['hash', 'hash_128', 'file_hash', 'FileHash', 'audio_hash'])
          if (!SONG_HASH_RE.test(hash)) return false
          const itemTitle = pickFrom(item, ['songname', 'SongName', 'audio_name', 'name']).toLowerCase()
          if (itemTitle !== targetTitle) return false
          if (!targetArtist) return true
          const itemArtist = pickFrom(item, ['singername', 'SingerName', 'author_name', 'singer']).toLowerCase()
          return itemArtist.includes(targetArtist) || targetArtist.includes(itemArtist)
        })
        if (!hit) return null
        return {
          hash: pickFrom(hit, ['hash', 'hash_128', 'file_hash', 'FileHash', 'audio_hash']),
          title: pickFrom(hit, ['songname', 'SongName', 'audio_name', 'name']) || title,
        }
      } catch (error) {
        console.warn('[music-card-share] 搜索反查歌曲失败', error)
        return null
      }
    }

    // 识别分享触发元素：
    //   row-menu —— 歌曲列表右键菜单里的「分享」（目标来自被右键的那一行）
    //   page     —— 页面上的分享按钮：播放栏/歌词页/歌曲详情页（Button 组件把 tooltip 输出为
    //               aria-label="分享"；另外兼容 title 与纯文本「分享」的按钮/菜单项）
    // 返回的 kind 决定“拦截后能否确定是歌曲分享”：
    //   row-menu / player —— 一定是歌曲分享；page —— 可能是别的资源（插件、歌单、专辑…），
    //   必须先从路由同步解析出歌曲才允许拦截，否则会误伤插件商店等处的分享
    const resolveTrigger = (target) => {
      const rowMenuItem = target.closest('button.song-context-item')
      if (rowMenuItem && String(rowMenuItem.textContent || '').trim() === '分享') return 'row-menu'
      const shareButton = target.closest('[aria-label="分享"], [title="分享"]')
      if (shareButton) {
        const inPlayerScope = Boolean(
          shareButton.closest('.lyric-bar')
          || shareButton.closest('.player-bar-action-strip')
          || shareButton.closest('.player-actions'),
        )
        return inPlayerScope ? 'player' : 'page'
      }
      const textItem = target.closest('button, [role="menuitem"]')
      if (textItem && String(textItem.textContent || '').trim() === '分享') return 'page'
      return ''
    }

    // 从当前路由读歌曲：歌曲详情页把歌曲放在路由参数里（hash/类型在 query，标题也在 query）
    const readRoutedSong = (href = String(window.location.href || '')) => {
      try {
        const url = new URL(href)
        const search = new URLSearchParams(url.search)
        const hashPart = String(url.hash || '')
        const queryIndex = hashPart.indexOf('?')
        const hashQuery = queryIndex >= 0 ? new URLSearchParams(hashPart.slice(queryIndex + 1)) : null
        const readParam = (key) => String(search.get(key) || hashQuery?.get(key) || '').trim()

        let hash = readParam('hash')
        if (!SONG_HASH_RE.test(hash)) {
          // 路径段里直接带 hash 的情况（如 /song/<hash>）
          const segments = `${url.pathname}/${hashPart.split('?')[0]}`.split('/')
          hash = segments.map((segment) => segment.trim()).find((segment) => SONG_HASH_RE.test(segment)) || ''
        }
        if (!SONG_HASH_RE.test(hash)) return null
        return { hash, title: readParam('title') }
      } catch {
        return null
      }
    }

    const currentTrackSong = () => {
      const track = ctx.player?.currentTrack?.value || ctx.stores?.player?.currentTrackSnapshot
      const hash = String(track?.hash || '').trim()
      if (!SONG_HASH_RE.test(hash)) return null
      return { hash, title: String(track?.name || track?.title || '').trim() }
    }

    // 右键行的歌曲：行上只有 song.id（且常是 mixSongId），按三级回退定位
    //   ① id 在所有 store 里反查 → ② 行内歌名/歌手在本地数据里匹配 → ③ 走搜索接口反查
    const resolveRowMenuSong = async () => {
      const byId = findSongById(lastContextSong.id)
      if (byId) return { hash: String(byId.hash), title: readSongTitle(byId) }

      const byText = findSongByText(lastContextSong.title, lastContextSong.artist)
      if (byText) {
        return { hash: String(byText.hash), title: readSongTitle(byText) || lastContextSong.title }
      }

      const searched = await searchSongByText(lastContextSong.title, lastContextSong.artist)
      if (searched) {
        return searched
      }
      return null
    }

    // 打开卡片弹窗（拼好分享文案）
    const openCardFor = (song) => {
      const url = buildSongShareUrl(song.hash)
      const text = song.title
        ? `EchoMusic 给你分享了歌曲「${song.title}」，快去看看吧\n${url}`
        : url
      void requestOpen({ hash: song.hash, title: song.title, url, text })
    }

    const onClickCapture = (event) => {
      const target = event.target
      if (!target?.closest) return
      const kind = resolveTrigger(target)
      if (!kind) return

      // 播放栏/歌词栏的分享：目标就是正在播放的歌，同步即可确定
      if (kind === 'player') {
        const song = currentTrackSong()
        if (!song) return
        event.preventDefault()
        event.stopPropagation()
        openCardFor(song)
        return
      }

      // 其他位置的分享按钮（详情页、插件商店、歌单页…）：只有能从路由同步解析出歌曲才拦。
      // 解析不出就完全放行 —— 否则插件商店这类非歌曲分享会被误拦，既没复制也没弹卡片。
      if (kind === 'page') {
        const song = readRoutedSong()
        if (!song) return
        event.preventDefault()
        event.stopPropagation()
        openCardFor(song)
        return
      }

      // 歌曲列表右键菜单：确定是歌曲分享，但行上只有 song.id，需要异步反查 ——
      // 先拦下（否则反查期间主程序已经把链接复制完了），再解析
      event.preventDefault()
      event.stopPropagation()
      void (async () => {
        try {
          const song = await resolveRowMenuSong()
          if (!song) {
            // 已拦下主程序的复制，但没能识别歌曲：明确告知，而不是悄悄复制
            ctx.toast.warning('没能识别这首歌，分享链接未复制')
            return
          }
          openCardFor(song)
        } catch (error) {
          console.warn('[music-card-share] 分享解析失败', error)
          ctx.toast.warning('分享失败，请稍后重试')
        }
      })()
    }

    document.addEventListener('contextmenu', rememberContextRow, true)
    document.addEventListener('click', onClickCapture, true)
    return () => {
      document.removeEventListener('contextmenu', rememberContextRow, true)
      document.removeEventListener('click', onClickCapture, true)
    }
  }

  // 安装两条接管路径：
  //   installCopyPatch       —— share.copy 可覆盖时，能从源头阻止复制（首选）
  //   installClipboardFallback —— 覆盖 navigator.clipboard.writeText；主程序目前优先走
  //     share.copy，只在 share.copy 缺失时才用剪贴板 API，所以它主要防御其它写入路径
  //   installShareTriggerHijack —— 点击劫持，share.copy 只读时唯一能“完全不触发主程序逻辑”的手段
  const restoreCopyPatch = installCopyPatch()
  const restoreClipboard = installClipboardFallback()
  const restoreHijack = installShareTriggerHijack()
  const restores = [restoreCopyPatch, restoreClipboard, restoreHijack].filter(Boolean)
  if (restores.length > 0) {
    ctx.dispose(() => {
      restores.forEach((restore) => restore())
      shareToastGuard?.dispose()
    })
  }

  // share.copy 不可覆盖时（Electron contextBridge 暴露的是只读属性），主程序会照常把链接
  // 写进剪贴板，且不会经过上面两个补丁，卡片弹窗只能靠事件兜底：复制完成后补弹一次。
  // 这种模式下不要吞「分享链接已复制」提示 —— 链接确实复制了，提示是准确的。
  if (!restoreCopyPatch) {
    console.warn('[music-card-share] share.copy 只读（contextBridge），无法阻止主程序复制链接，改用分享后弹窗模式')
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
