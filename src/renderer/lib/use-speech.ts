import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export function useSpeech(enabled: boolean, contextKey: string, append: (text: string) => void) {
  const [recording, setRecording] = useState(false),
    [transcribing, setTranscribing] = useState(false)
  const [speaking, setSpeaking] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null)
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null),
    audioUrl = useRef<string | null>(null)
  const playback = useRef(0),
    mounted = useRef(true),
    discard = useRef(false),
    acquiring = useRef(false)
  const recordingEpoch = useRef(0)
  const appendRef = useRef(append)
  appendRef.current = append
  const stopAudio = () => {
    playback.current++
    const current = audio.current
    audio.current = null
    if (current) {
      current.pause()
      current.dispatchEvent(new Event('ended'))
    }
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current)
    audioUrl.current = null
    if (mounted.current) setSpeaking(null)
  }
  const stopRecording = () => {
    if (recordingTimer.current) clearTimeout(recordingTimer.current)
    if (recorder.current?.state === 'recording') recorder.current.stop()
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      discard.current = true
      stopRecording()
      stopAudio()
    }
  }, [])
  useEffect(() => {
    if (!enabled) {
      discard.current = true
      stopRecording()
      stopAudio()
    }
  }, [enabled])
  useEffect(() => {
    recordingEpoch.current++
    discard.current = true
    stopRecording()
    stopAudio()
  }, [contextKey])
  const toggleRecording = async () => {
    if (recording) {
      stopRecording()
      return
    }
    if (!enabled || transcribing || acquiring.current) return
    acquiring.current = true
    try {
      discard.current = false
      const epoch = ++recordingEpoch.current
      stopAudio()
      const input = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      if (!mounted.current || discard.current) {
        input.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current = input
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      )
      if (!mimeType) throw new Error('当前系统不支持录音。')
      const next = new MediaRecorder(input, { mimeType }),
        chunks: BlobPart[] = []
      let size = 0
      recorder.current = next
      next.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data)
          size += event.data.size
        }
        if (size > 24 * 1024 * 1024) stopRecording()
      }
      next.onstop = async () => {
        stopRecording()
        recorder.current = null
        if (!mounted.current) return
        setRecording(false)
        if (discard.current || !chunks.length) return
        setTranscribing(true)
        try {
          const text = await window.flowchat.transcribe(
            await new Blob(chunks, { type: mimeType }).arrayBuffer(),
            mimeType,
          )
          if (mounted.current && !discard.current && recordingEpoch.current === epoch)
            appendRef.current(text)
        } catch (error) {
          if (mounted.current) toast.error((error as Error).message)
        } finally {
          if (mounted.current) setTranscribing(false)
        }
      }
      next.onerror = () => {
        discard.current = true
        stopRecording()
        setRecording(false)
        toast.error('录音失败，请检查麦克风。')
      }
      next.start(1000)
      setRecording(true)
      recordingTimer.current = setTimeout(stopRecording, 180_000)
    } catch (error) {
      stopRecording()
      toast.error(`无法开始录音：${(error as Error).message}`)
    } finally {
      acquiring.current = false
    }
  }
  const speak = async (id: string, text: string) => {
    if (speaking === id) {
      stopAudio()
      return
    }
    stopAudio()
    if (!enabled || !text.trim()) return
    const token = playback.current
    setSpeaking(id)
    try {
      let remaining = text.trim()
      while (remaining && playback.current === token) {
        let end = Math.min(4000, remaining.length)
        if (end < remaining.length) {
          const boundary = Math.max(
            remaining.lastIndexOf('。', end),
            remaining.lastIndexOf('\n', end),
            remaining.lastIndexOf('. ', end),
          )
          if (boundary > 2000) end = boundary + 1
        }
        const bytes = await window.flowchat.synthesize(remaining.slice(0, end))
        if (playback.current !== token || !mounted.current) return
        const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'audio/mpeg' }))
        const player = new Audio(url)
        audio.current = player
        audioUrl.current = url
        await new Promise<void>((resolve, reject) => {
          player.onended = () => resolve()
          player.onerror = () => reject(new Error('无法播放朗读音频。'))
          void player.play().catch(reject)
        })
        URL.revokeObjectURL(url)
        if (audioUrl.current === url) {
          audioUrl.current = null
          audio.current = null
        }
        remaining = remaining.slice(end)
      }
    } catch (error) {
      if (playback.current === token) toast.error((error as Error).message)
    } finally {
      if (playback.current === token) stopAudio()
    }
  }
  return { recording, transcribing, speaking, toggleRecording, speak, stopAudio }
}
