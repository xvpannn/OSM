import { useState, useEffect } from 'react'
import type { View } from '../types'

interface Props {
  onNavigate: (v: View, countryCode?: 'us' | 'uk') => void
  targetCountry: 'us' | 'uk'
}

export default function AccessView({ onNavigate, targetCountry }: Props) {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  
  // OTP state
  const [isOtpSent, setIsOtpSent] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [countdown, setCountdown] = useState(300) // 5 minutes
  
  // Interface states
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Countdown timer for OTP expiry
  useEffect(() => {
    if (!isOtpSent) return
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          setErrorMessage('Your OTP code has expired. Please request a new one.')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [isOtpSent])

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60)
    const s = secs % 60
    return `${mins}:${s < 10 ? '0' : ''}${s}`
  }

  // Handle requesting login/signup OTP
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    
    if (!email || !password) {
      setErrorMessage('Please fill out all credentials.')
      return
    }

    setLoading(true)
    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/signup'
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Server connection failed.')
      }

      setIsOtpSent(true)
      setCountdown(300)
      setSuccessMessage(data.message || 'A secure 6-digit access code has been dispatched.')
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Handle verifying OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')

    if (otpCode.length !== 6) {
      setErrorMessage('Please enter the full 6-digit access code.')
      return
    }

    setLoading(true)
    
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otpCode })
      })
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Verification failed.')
      }

      // Save session credentials
      localStorage.setItem('osm_session_token', data.token)
      localStorage.setItem('osm_user_email', data.email)
      localStorage.setItem('osm_is_master', data.isMaster ? 'true' : 'false')

      setSuccessMessage('Secure authorization approved. Accessing terminal node...')
      
      setTimeout(() => {
        onNavigate('dashboard', targetCountry)
      }, 1000)
    } catch (err: any) {
      setErrorMessage(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Reset OTP flow to try again
  const handleBackToAuth = () => {
    setIsOtpSent(false)
    setOtpCode('')
    setErrorMessage('')
    setSuccessMessage('')
  }

  return (
    <div className="min-h-screen w-full bg-zinc-950 flex flex-col items-center justify-center p-6 relative select-none">
      <div className="fixed inset-0 z-[-1] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-black pointer-events-none" />
      <div className="absolute inset-0 grid-bg opacity-[0.03] pointer-events-none" />

      {/* Decorative ambient glowing circles */}
      <div className="absolute w-[40vw] h-[40vh] rounded-full bg-white/[0.01] blur-[120px] pointer-events-none top-1/4 left-1/4" />

      <div className="w-full max-w-md animate-apple-in">
        
        {/* Monospaced Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center items-center gap-2.5 mb-2">
            <span className="w-2.5 h-2.5 bg-white rounded-full animate-pulse shadow-[0_0_8px_#ffffff]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500 font-bold">
              Secure Authorization Req
            </span>
          </div>
          <h2 
            onClick={() => onNavigate('landing')}
            className="text-4xl font-extrabold tracking-[0.3em] font-mono text-white text-gradient pl-[0.3em] uppercase cursor-pointer"
          >
            OSM
          </h2>
          <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-500 mt-2">
            NODE ACCESS GATEWAY &bull; {targetCountry.toUpperCase()}_SECTOR
          </p>
        </div>

        {/* Auth Glassmorphism Container */}
        <div className="premium-card p-8 rounded-2xl relative overflow-hidden backdrop-blur-md">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-zinc-700 to-transparent" />
          
          {/* Notifications Panel */}
          {errorMessage && (
            <div className="mb-6 p-4 rounded-lg bg-red-950/20 border border-red-900/40 text-red-500 font-mono text-[11px] leading-relaxed text-left flex items-start gap-2.5">
              <span className="text-red-400 font-bold">[!]</span>
              <span>{errorMessage}</span>
            </div>
          )}
          {successMessage && (
            <div className="mb-6 p-4 rounded-lg bg-zinc-900/55 border border-zinc-800 text-zinc-200 font-mono text-[11px] leading-relaxed text-left flex items-start gap-2.5">
              <span className="text-white font-bold">[✓]</span>
              <span>{successMessage}</span>
            </div>
          )}

          {!isOtpSent ? (
            /* Signin / Signup Switch Forms */
            <div>
              {/* Sliding Mode Tab */}
              <div className="flex bg-zinc-900/50 p-1 rounded-lg border border-zinc-800/40 mb-8 relative font-mono text-[10px] uppercase font-bold tracking-widest">
                <button
                  type="button"
                  onClick={() => { setIsLogin(true); setErrorMessage(''); }}
                  className={`flex-1 py-2 rounded-md transition-all duration-300 relative z-10 ${isLogin ? 'text-black font-extrabold' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  Log In Node
                </button>
                <button
                  type="button"
                  onClick={() => { setIsLogin(false); setErrorMessage(''); }}
                  className={`flex-1 py-2 rounded-md transition-all duration-300 relative z-10 ${!isLogin ? 'text-black font-extrabold' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  Register Node
                </button>
                
                {/* Slidder indicator background */}
                <div 
                  className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-md transition-all duration-500 ease-spring ${
                    isLogin ? 'left-1' : 'left-[50%]'
                  }`} 
                />
              </div>

              {/* Login / Register Fields */}
              <form onSubmit={handleSubmit} className="space-y-6 text-left">
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-widest text-zinc-500 mb-2 font-bold">
                    Email Signature
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operator@company.com"
                    required
                    disabled={loading}
                    className="w-full bg-zinc-950/80 border border-zinc-800/80 rounded-lg px-4 py-3 text-sm font-mono text-white placeholder-zinc-700 focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 transition duration-300"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-widest text-zinc-500 mb-2 font-bold">
                    Security Passphrase
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    disabled={loading}
                    className="w-full bg-zinc-950/80 border border-zinc-800/80 rounded-lg px-4 py-3 text-sm font-mono text-white placeholder-zinc-700 focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 transition duration-300"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-white hover:bg-zinc-200 text-black font-mono font-bold text-xs uppercase tracking-widest py-3.5 transition-all rounded-lg hover:scale-[1.01] shadow-lg active:scale-[0.99] flex items-center justify-center gap-2 mt-8 disabled:opacity-40 disabled:hover:bg-white"
                >
                  {loading ? (
                    <span className="flex items-center gap-2.5">
                      <span className="w-1.5 h-1.5 bg-black rounded-full animate-ping" />
                      Authorising Node...
                    </span>
                  ) : (
                    <span>Access Terminal &rarr;</span>
                  )}
                </button>
              </form>
            </div>
          ) : (
            /* OTP Dispatch Entry View */
            <form onSubmit={handleVerifyOtp} className="space-y-8">
              <div className="text-left font-mono">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold block mb-1">
                  Cryptographic verification
                </span>
                <p className="text-[11px] text-zinc-400 leading-relaxed animate-apple-fade">
                  Enter the 6-digit authorization code dispatched to <code className="text-white font-bold bg-zinc-900 px-1.5 py-0.5 rounded">{email}</code> below.
                </p>
              </div>

              {/* Monospace Code Single Input Column */}
              <div className="py-2 animate-apple-in">
                <input
                  type="text"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="000000"
                  disabled={loading}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg text-center font-mono font-extrabold text-3xl py-3 text-white tracking-[0.6em] pl-[0.6em] focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition duration-300"
                />
              </div>

              {/* Countdown Timer Display */}
              <div className="flex justify-between items-center font-mono text-[10px] border-t border-zinc-900 pt-6">
                <span className="text-zinc-500 uppercase tracking-wider font-bold">Expiration Window:</span>
                <span className={`font-mono font-bold tracking-widest ${countdown < 60 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                  {formatTime(countdown)}
                </span>
              </div>

              <div className="space-y-3.5 pt-4">
                <button
                  type="submit"
                  disabled={loading || countdown === 0}
                  className="w-full bg-white hover:bg-zinc-200 text-black font-mono font-bold text-xs uppercase tracking-widest py-3.5 transition-all rounded-lg hover:scale-[1.01] shadow-lg active:scale-[0.99] disabled:opacity-40"
                >
                  {loading ? 'Verifying Credentials...' : 'Confirm Verification & Access'}
                </button>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleBackToAuth}
                    disabled={loading}
                    className="flex-1 bg-zinc-950 hover:bg-zinc-900 text-zinc-400 border border-zinc-900 font-mono text-[9px] uppercase tracking-widest py-3 rounded-lg transition"
                  >
                    &larr; Back
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={loading || countdown > 240} // Prevent spamming within first minute
                    className="flex-1 bg-zinc-950 hover:bg-zinc-900 text-zinc-400 border border-zinc-900 font-mono text-[9px] uppercase tracking-widest py-3 rounded-lg transition disabled:opacity-30"
                  >
                    Resend Code
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <button
            onClick={() => onNavigate('landing')}
            className="font-mono text-[10px] uppercase tracking-widest text-zinc-600 hover:text-zinc-300 transition"
          >
            &larr; Return to main landing
          </button>
        </div>
      </div>
    </div>
  )
}
