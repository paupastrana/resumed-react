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
        headers: { 'Content-Type':'application/json' },
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
    
    <div style={{maxWidth:380, margin:'80px auto'}}>
      <h2>Acceso Médicos</h2>
      
      <form onSubmit={submit} style={{display:'grid', gap:8}}>
        <input type="email" placeholder="Correo" value={email} onChange={e=>setEmail(e.target.value)} required/>
        <input type="password" placeholder="Contraseña" value={password} onChange={e=>setPassword(e.target.value)} required/>
        <button type="submit">Entrar</button>
        {err && <div style={{color:'crimson'}}>{err}</div>}
      </form>
    </div>
  );
}
