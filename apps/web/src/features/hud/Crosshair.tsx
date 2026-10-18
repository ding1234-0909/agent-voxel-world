/**
 * Minecraft 风格十字准星（参考原版 index.html 第 15-18 行 #crosshair 样式）。
 * 纯 CSS 绘制：白色四臂 + 黑色描边阴影，中心留小空隙，不拦截鼠标事件。
 */
export function Crosshair() {
  return (
    <div className="mc-crosshair" aria-hidden="true">
      <span className="mc-crosshair__v mc-crosshair__v--top" />
      <span className="mc-crosshair__v mc-crosshair__v--bottom" />
      <span className="mc-crosshair__h mc-crosshair__h--left" />
      <span className="mc-crosshair__h mc-crosshair__h--right" />
    </div>
  );
}
