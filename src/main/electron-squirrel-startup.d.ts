declare module 'electron-squirrel-startup' {
  /** true 表示本次进程是被 Squirrel 安装/更新事件唤起，应尽快退出。 */
  const started: boolean;
  export default started;
}
