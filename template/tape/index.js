// 复古磁带卡片模板（磁带壳造型 + 封面标签 + 带轮窗口）
module.exports = {
  id: 'tape',
  name: '磁带',

  async init(ctx) {
    this.css = await ctx.loadText('style.css')
  },

  html(data) {
    const { escapeHtml, coverImg, brandHtml, textEllipsis } = this.helpers
    return `<style>${this.css}</style>
<div class="mcsg-card mcsg-card--tape">
  <div class="shell">
    <div class="label">
      ${coverImg(data, 'label-cover')}
      <div class="label-info">
        <div class="label-side">SIDE A</div>
        <div class="label-name">${escapeHtml(data.name)}</div>
        <div class="label-artist">${escapeHtml(data.artist)}</div>
      </div>
    </div>
    <div class="window"><div class="tape-line"></div><div class="reel"></div><div class="reel"></div></div>
    <div class="screws"><div class="screw"></div><div class="screw"></div><div class="screw"></div><div class="screw"></div></div>
  </div>
  <div class="info">
    <div class="name">${escapeHtml(data.name)}</div>
    <div class="artist">${escapeHtml(data.artist)}</div>
  </div>
  ${brandHtml(data)}
</div>`
  },
}
