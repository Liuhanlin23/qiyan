// Edge TTS 合成转发的 IPC 注册（引擎实现在 edgeTts.ts，与 db.ts / dbExecutor.ts 同一分工）。
import { ipcMain } from 'electron'
import type { TtsSynthesizeRequest, TtsSynthesizeResult } from '../shared/tts'
import { synthesize } from './edgeTts'

/** main whenReady 时注册一次。 */
export function registerTtsIpc(): void {
  ipcMain.handle(
    'tts:synthesize',
    async (_event, req: TtsSynthesizeRequest): Promise<TtsSynthesizeResult> => {
      const text = req.text.replace(/\s+/g, ' ').trim()
      if (!text) return { audio: new ArrayBuffer(0), boundaries: [] }
      return synthesize({ ...req, text })
    },
  )
}
