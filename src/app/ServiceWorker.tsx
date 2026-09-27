'use client'
import { useEffect } from 'react'
export default function ServiceWorker() { useEffect(() => { if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined) }, []); return null }
