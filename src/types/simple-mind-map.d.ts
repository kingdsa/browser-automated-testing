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
    on<TArgs extends unknown[]>(event: string, callback: (...args: TArgs) => void): void
    off<TArgs extends unknown[]>(event: string, callback: (...args: TArgs) => void): void
    setData(data: unknown): void
    setMode(mode: 'readonly' | 'edit'): void
    getData(withConfig?: boolean): unknown
    resize(): void
    render(callback?: () => void, source?: string): void
    destroy(): void
    view: {
      fit?: () => void
      getTransformData?: () => unknown
      setTransformData?: (data: unknown) => void
    };
    [key: string]: unknown
  }
}

declare module 'simple-mind-map/dist/simpleMindMap.esm.css'
