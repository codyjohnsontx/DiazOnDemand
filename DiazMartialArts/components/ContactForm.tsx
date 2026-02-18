'use client';

import { FormEvent, useState } from 'react';

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function ContactForm() {
  const endpoint = process.env.NEXT_PUBLIC_FORMSPREE_ENDPOINT;
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!endpoint) {
      setStatus('error');
      setError('Add NEXT_PUBLIC_FORMSPREE_ENDPOINT to enable form submissions.');
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);

    const name = String(formData.get('name') || '').trim();
    const email = String(formData.get('email') || '').trim();
    const message = String(formData.get('message') || '').trim();

    if (!name || !email || !message) {
      setStatus('error');
      setError('Please complete name, email, and message fields.');
      return;
    }

    setStatus('submitting');

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        body: formData,
      });

      if (!response.ok) {
        setStatus('error');
        setError('Your request could not be sent. Please try again.');
        return;
      }

      setStatus('success');
      form.reset();
    } catch {
      setStatus('error');
      setError('Network error. Please try again in a moment.');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-semibold text-ink">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
        />
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-semibold text-ink">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
        />
      </div>

      <div>
        <label htmlFor="phone" className="mb-1 block text-sm font-semibold text-ink">
          Phone (optional)
        </label>
        <input
          id="phone"
          name="phone"
          className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
        />
      </div>

      <div>
        <label htmlFor="message" className="mb-1 block text-sm font-semibold text-ink">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={5}
          className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
        />
      </div>

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="inline-flex items-center justify-center rounded-full bg-ember px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#941f15] disabled:cursor-not-allowed disabled:opacity-75"
      >
        {status === 'submitting' ? 'Sending...' : 'Send Message'}
      </button>

      <p aria-live="polite" className="text-sm text-black/70">
        {status === 'success' && 'Thanks. We received your message and will reply soon.'}
        {status === 'error' && error}
      </p>
    </form>
  );
}
