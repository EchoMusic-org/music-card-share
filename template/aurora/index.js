// 氛围卡片模板（封面强模糊渐变背景 + 圆形大封面光晕 + 居中文字，Apple Music 风格）
module.exports = {
  id: 'aurora',
  name: '氛围',

  async init(ctx) {
    this.css = await ctx.loadText('style.css')
  },

  html(data) {
    const { escapeHtml, coverStyle, coverImg, brandHtml, textEllipsis } = this.helpers
    return `<style>${this.css}</style>
<div class="mcsg-card mcsg-card--aurora">
  <div class="bg" style="${coverStyle(data)}"></div>
  <div class="tint"></div>
  <div class="stage">
    ${coverImg(data, 'cover')}
    <div class="name">${escapeHtml(data.name)}</div>
    <div class="artist">${escapeHtml(data.artist)}</div>
  </div>
  ${brandHtml(data)}
</div>`
  },
}
