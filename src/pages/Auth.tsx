import { useMemo, useState } from 'react'
import { Cpu, KeyRound, Mail } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { supabase, getEnvMissing } from '@/utils/supabase'
import { useAuthStore } from '@/stores/authStore'

export default function AuthPage() {
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
      const normalizedEmail = email.trim().toLowerCase()
      const { data: isAdmin, error: permErr } = await supabase.rpc('check_admin_email', { p_email: normalizedEmail })
      if (permErr) throw new Error('權限驗證失敗，請稍後再試')
      if (!isAdmin) throw new Error('此帳號沒有管理員權限，無法登入')

      const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
      if (error) throw error

      setMsg('登入成功')
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
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>登入</CardTitle>
          </CardHeader>
          <CardContent>
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
                  autoComplete="current-password"
                />
              </label>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => void onReset()} disabled={busy || missing.length > 0}>
                忘記密碼
              </Button>
              <Button type="button" onClick={() => void onSubmit()} disabled={!canSubmit}>
                登入
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
