declare global {
  type SoundCloudSound = {
    id?: number
    title?: string
    permalink_url?: string
    user?: { username?: string; permalink_url?: string }
  }

  type SoundCloudWidgetInstance = {
    bind: (eventName: string, listener: (event?: unknown) => void) => void
    unbind: (eventName: string) => void
    load: (url: string, options?: Record<string, unknown>) => void
    play: () => void
    pause: () => void
    toggle: () => void
    skip: (index: number) => void
    setVolume: (volume: number) => void
    getSounds: (callback: (sounds: SoundCloudSound[]) => void) => void
    getCurrentSound: (callback: (sound: SoundCloudSound) => void) => void
    isPaused: (callback: (paused: boolean) => void) => void
  }

  interface Window {
    SC?: {
      Widget: {
        (iframe: HTMLIFrameElement): SoundCloudWidgetInstance
        Events: {
          READY: string
          PLAY: string
          PAUSE: string
          FINISH: string
          ERROR?: string
        }
      }
    }
  }
}

export {}
