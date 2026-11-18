/**
 * 把 Vue 的响应式代理还原成普通对象。
 *
 * 渲染层的结果对象是 reactive 代理，直接传给 IPC 会在参数序列化阶段失败
 * （跨进程只能传结构化可克隆的纯数据），所以发给主进程的载荷一律先过这里。
 */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
