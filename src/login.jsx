import { useState } from 'react';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const r = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Login falló');
      onLogin(data.user);
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: 'linear-gradient(135deg, #e0f7fa, #e3f2fd)',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{
        width: '100%',
        maxWidth: 420,
        padding: '32px 28px',
        borderRadius: 16,
        background: '#fff',
        boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
        textAlign: 'center'
      }}>
        <h1 style={{
          margin: 0,
          fontSize: 32,
          fontWeight: 700,
          color: '#2c3e50'
        }}>
          ResuMed
        </h1>
        <p style={{
          marginTop: 4,
          marginBottom: 24,
          fontSize: 16,
          color: '#555'
        }}>
          Acceso exclusivo para médicos
        </p>

        <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <input
            type="email"
            placeholder="Correo electrónico"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid #ccc',
              fontSize: 15,
              outline: 'none',
              transition: 'border-color 0.2s'
            }}
            onFocus={e => e.target.style.borderColor = '#3498db'}
            onBlur={e => e.target.style.borderColor = '#ccc'}
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid #ccc',
              fontSize: 15,
              outline: 'none',
              transition: 'border-color 0.2s'
            }}
            onFocus={e => e.target.style.borderColor = '#3498db'}
            onBlur={e => e.target.style.borderColor = '#ccc'}
          />
          <button
            type="submit"
            style={{
              padding: '14px',
              borderRadius: 8,
              border: 'none',
              background: '#3498db',
              color: '#fff',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.25s, transform 0.1s'
            }}
            onMouseOver={e => e.currentTarget.style.background = '#2980b9'}
            onMouseOut={e => e.currentTarget.style.background = '#3498db'}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.97)'}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            Iniciar sesión
          </button>
          {err && (
            <div style={{
              color: 'crimson',
              marginTop: 6,
              fontSize: 14,
              fontWeight: 500
            }}>
              {err}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
