// 毛玻璃播放器卡片模板（示例图同款：封面模糊背景 + 玻璃面板 + 进度条 + 播放控制）
module.exports = {
  id: 'glass',
  name: '毛玻璃',

  // 可选异步初始化：加载模板目录内的资源文件
  async init(ctx) {
    this.css = await ctx.loadText('style.css')
  },

  // 同步渲染：返回卡片 HTML，根元素必须为 .mcsg-card，尺寸 750×1000
  html(data) {
    const { escapeHtml, coverStyle, coverImg, brandHtml, textEllipsis } = this.helpers
    return `<style>${this.css}</style>
<div class="mcsg-card mcsg-card--glass">
  <div class="bg" style="${coverStyle(data)}"></div>
  <div class="shade"></div>
  <div class="panel">
    ${coverImg(data, 'cover')}
    <div class="name">${escapeHtml(data.name)}</div>
    <div class="artist">${escapeHtml(data.artist)}</div>
  </div>
  <div class="progress">
    <div class="bar"><div class="bar-played"></div><div class="bar-dot"></div></div>
    <div class="times"><span>${data.playedText}</span><span>${data.remainText}</span></div>
  </div>
  <div class="controls">
    <svg viewBox="0 0 24 24" width="54" height="54" fill="#fff"><path d="M6 5h2.6v14H6zM20 5v14L9.6 12z"/></svg>
    <svg viewBox="0 0 24 24" width="76" height="76" fill="#fff"><rect x="5.6" y="4" width="4.8" height="16" rx="2.2"/><rect x="13.6" y="4" width="4.8" height="16" rx="2.2"/></svg>
    <svg viewBox="0 0 24 24" width="54" height="54" fill="#fff"><path d="M4 5v14l10.4-7zM15.4 5H18v14h-2.6z"/></svg>
  </div>
  ${brandHtml(data)}
</div>`
  },
}
