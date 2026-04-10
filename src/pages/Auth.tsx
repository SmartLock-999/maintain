import { useMemo, useState } from 'react'
import { Cpu, KeyRound, Mail } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { supabase, getEnvMissing } from '@/utils/supabase'
import { useAuthStore } from '@/stores/authStore'

type Mode = 'login' | 'register'

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const envMissing = useAuthStore((s) => s.envMissing)

  const missing = useMemo(() => (envMissing.length ? envMissing : getEnvMissing()), [envMissing])

  const canSubmit = email.trim() && password.trim() && !busy && missing.length === 0

  const onSubmit = async () => {
    setErr(null)
    setMsg(null)
    setBusy(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        setMsg('登入成功')
        return
      }

      const { error } = await supabase.auth.signUp({ email, password })
      if (error) throw error
      setMsg('註冊成功，請檢查信箱完成驗證（若你已開啟 Email 驗證）')
    } catch (e) {
      const message = e instanceof Error ? e.message : '操作失敗'
      setErr(message)
    } finally {
      setBusy(false)
    }
  }

  const onReset = async () => {
    setErr(null)
    setMsg(null)
    if (!email.trim()) {
      setErr('請先輸入 Email')
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email)
      if (error) throw error
      setMsg('已寄出重設密碼信件（若該帳號存在）')
    } catch (e) {
      const message = e instanceof Error ? e.message : '操作失敗'
      setErr(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0B1020] px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/10 p-3 text-cyan-200">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-semibold">Smart Lock Console</div>
            <div className="text-sm text-slate-400">暗色科技風管理後台</div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>登入 / 註冊</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={mode === 'login' ? 'primary' : 'secondary'}
                onClick={() => setMode('login')}
              >
                登入
              </Button>
              <Button
                type="button"
                variant={mode === 'register' ? 'primary' : 'secondary'}
                onClick={() => setMode('register')}
              >
                註冊
              </Button>
            </div>

            {missing.length ? (
              <div className="mb-4 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
                尚未設定環境變數：{missing.join(', ')}（請參考 `.env.example`）
              </div>
            ) : null}

            {err ? (
              <div className="mb-4 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
                {err}
              </div>
            ) : null}
            {msg ? (
              <div className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
                {msg}
              </div>
            ) : null}

            <div className="space-y-3">
              <label className="block">
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                  <Mail className="h-4 w-4" />
                  Email
                </div>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" />
              </label>
              <label className="block">
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                  <KeyRound className="h-4 w-4" />
                  Password
                </div>
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </label>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => void onReset()} disabled={busy || missing.length > 0}>
                忘記密碼
              </Button>
              <Button type="button" onClick={() => void onSubmit()} disabled={!canSubmit}>
                {mode === 'login' ? '登入' : '建立帳號'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 text-center text-xs text-slate-500">部署到 GitHub Pages 時請使用 HTTPS 才能取得定位</div>
      </div>
    </div>
  )
}
