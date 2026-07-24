declare module 'simple-mind-map' {
  export interface MindMapOptions {
    el: HTMLElement
    data?: unknown
    readonly?: boolean
    layout?: string
    theme?: string
    themeConfig?: Record<string, unknown>
    mousewheelAction?: string
    mousewheelZoomActionReverse?: boolean
    textAutoWrapWidth?: number
    [key: string]: unknown
  }

  export default class MindMap {
    constructor(options: MindMapOptions)
    on(event: string, callback: (...args: any[]) => void): void
    off(event: string, callback: (...args: any[]) => void): void
    setData(data: unknown): void
    getData(withConfig?: boolean): unknown
    resize(): void
    destroy(): void
    view: {
      fit?: () => void
      getTransformData?: () => unknown
      setTransformData?: (data: unknown) => void
    }
    [key: string]: any
  }
}

declare module 'simple-mind-map/dist/simpleMindMap.esm.css'
