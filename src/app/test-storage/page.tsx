'use client';

import { useState } from 'react';

const GATEWAY = 'https://api-gateway-production-6a68.up.railway.app';

export default function TestStoragePage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const token = typeof window !== 'undefined'
    ? localStorage.getItem('tec_access_token')
    : null;

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // ✅ 1. Get Upload URL
  const handleGetUploadUrl = async () => {
    if (!selectedFile) return alert('اختار file أول');
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${GATEWAY}/api/storage/upload-url`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          filename: selectedFile.name,
          mimeType: selectedFile.type,
          size: selectedFile.size,
          folder: 'profiles',
        }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ✅ 2. Upload مباشر لـ R2
  const handleDirectUpload = async () => {
    if (!selectedFile || !result?.data?.uploadUrl) {
      return alert('اعمل Get Upload URL أول');
    }
    setLoading(true);
    setError(null);
    try {
      const uploadRes = await fetch(result.data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': selectedFile.type },
        body: selectedFile,
      });

      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);

      // ✅ 3. Save metadata
      const saveRes = await fetch(`${GATEWAY}/api/storage/files`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          key: result.data.key,
          filename: selectedFile.name,
          mimeType: selectedFile.type,
          size: selectedFile.size,
        }),
      });
      const saveData = await saveRes.json();
      setResult(saveData);
      alert('✅ File uploaded successfully!');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ✅ 4. Get Files
  const handleGetFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${GATEWAY}/api/storage/files`, {
        headers: authHeaders,
      });
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: 'monospace' }}>
      <h1>📦 Storage Test</h1>

      <p>Token: {token ? '✅ موجود' : '❌ مفيش — روح /test-identity أول'}</p>

      <div style={{ marginBottom: 20 }}>
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
        />
        {selectedFile && (
          <p>📁 {selectedFile.name} ({Math.round(selectedFile.size / 1024)}KB)</p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <button onClick={handleGetUploadUrl} disabled={loading || !token}>
          1️⃣ Get Upload URL
        </button>
        <button onClick={handleDirectUpload} disabled={loading || !result?.data?.uploadUrl}>
          2️⃣ Upload to R2
        </button>
        <button onClick={handleGetFiles} disabled={loading || !token}>
          3️⃣ Get My Files
        </button>
      </div>

      {loading && <p>⏳ Loading...</p>}
      {error && <p style={{ color: 'red' }}>❌ {error}</p>}
      {result && (
        <pre style={{
          background: '#111',
          color: '#0f0',
          padding: 10,
          overflow: 'auto',
          maxHeight: 400,
        }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
  }
