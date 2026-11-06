import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signedIn = vi.fn();
const restMock = vi.fn();
const browser = vi.hoisted(() => ({ supported: true, start: vi.fn() }));

vi.mock('../session', () => ({ useSession: () => ({ signedIn }) }));
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), rest: (...a: unknown[]) => restMock(...a) }));
vi.mock('@simplewebauthn/browser', () => ({ browserSupportsWebAuthn: () => browser.supported, startAuthentication: (...a: unknown[]) => browser.start(...a), startRegistration: vi.fn() }));

import { ApiError } from '../api';
import { I18nProvider } from '../i18n';
import { DigitBoxes, EmailCodeStep, LoginPage } from './Auth';
import { useState } from 'react';

const USER = { user: { id: 1, email: 'ada@example.com' }, shop: { id: 1, name: 'Shop' } };
const METHODS = { passwordReset: true, passkeys: { rpId: 'localhost' }, links: { help: 'https://example.com/help', terms: null, privacy: null } };
let routes: Record<string, (body?: unknown) => unknown> = {};

const wrap = (ui: React.ReactElement) => render(<I18nProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider></I18nProvider>);

beforeEach(() => {
  signedIn.mockReset(); browser.start.mockReset(); browser.supported = true;
  try { localStorage.clear(); localStorage.setItem('shopme.lang', 'en'); } catch { /* ignore */ }
  routes = { '/auth/methods': () => METHODS, '/setup/status': () => ({ needsSetup: false }) };
  restMock.mockReset();
  restMock.mockImplementation(async (path: string, init?: { body?: unknown }) => {
    const h = routes[path];
    if (!h) throw new ApiError('Not found', 404);
    return h(init?.body);
  });
});
afterEach(() => { vi.useRealTimers(); });

const calls = (path: string) => restMock.mock.calls.filter((c) => c[0] === path);

describe('login, e-mail first', () => {
  it('returns from password reset without stale login errors and uses the email that was reset', async () => {
    const user = userEvent.setup();
    routes['/auth/login'] = () => { throw new ApiError('Invalid email or password', 401); };
    routes['/auth/password/forgot'] = () => ({});
    routes['/auth/password/reset'] = () => ({});
    wrap(<LoginPage />);
    await user.type(await screen.findByLabelText('Email'), 'old@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Password'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'reset@example.com');
    await user.click(screen.getByRole('button', { name: 'Send the code' }));
    await user.type(await screen.findByLabelText('Digit 1'), '123456');
    await user.type(screen.getByLabelText('New password'), 'new password');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    const notice = 'Your password was changed. You can log in now.';
    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(screen.queryByText('Incorrect email or password.')).not.toBeInTheDocument();
    expect(screen.getByTestId('login-email')).toHaveTextContent('reset@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    await user.type(screen.getByLabelText('Password'), 'new password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    expect(screen.queryByText(notice)).not.toBeInTheDocument();
    expect(calls('/auth/login').at(-1)?.[1]).toEqual({ body: { email: 'reset@example.com', password: 'new password' } });
  });

  it('asks for the e-mail alone, then the password with the e-mail shown and a way to change it', async () => {
    const user = userEvent.setup();
    wrap(<LoginPage />);
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByText('Continue to ShopMe')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    // Nothing is sent to the server at the e-mail step (so nothing can reveal whether the account exists).
    expect(calls('/auth/login')).toHaveLength(0);
    expect(screen.getByTestId('login-email')).toHaveTextContent('ada@example.com');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forgot your password?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('signs in with the password and keeps the same error whatever is wrong', async () => {
    const user = userEvent.setup();
    let ok = false;
    routes['/auth/login'] = () => { if (!ok) throw new ApiError('Invalid email or password', 401); return USER; };
    wrap(<LoginPage />);
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Password'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    expect(signedIn).not.toHaveBeenCalled();
    ok = true;
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(signedIn).toHaveBeenCalledWith(USER));
    expect(calls('/auth/login')[1]![1]).toEqual({ body: { email: 'ada@example.com', password: 'wrong password' } });
    expect(localStorage.getItem('shopme.lastSignIn')).toBe('password');
  });

  it('goes to the authenticator step when the account has two-step verification', async () => {
    const user = userEvent.setup();
    routes['/auth/login'] = () => ({ twoFactorRequired: true, challenge: 'c'.repeat(20) });
    routes['/auth/login/2fa'] = () => USER;
    wrap(<LoginPage />);
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Password'), 'a password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'Two-step verification' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: /Verify/ }));
    await waitFor(() => expect(signedIn).toHaveBeenCalled());
  });

  it('shows the Start link only when the installation has no store yet', async () => {
    routes['/setup/status'] = () => ({ needsSetup: true });
    wrap(<LoginPage />);
    expect(await screen.findByRole('link', { name: /Get started/ })).toHaveAttribute('href', '/admin/');
  });
});

describe('passkey button', () => {
  it('signs in without an e-mail and remembers the method; the badge shows on the next visit', async () => {
    const user = userEvent.setup();
    routes['/auth/passkey/login/options'] = () => ({ id: 'abcdefghijkl', options: { challenge: 'x' } });
    routes['/auth/passkey/login/verify'] = () => USER;
    browser.start.mockResolvedValue({ id: 'cred' });
    const first = wrap(<LoginPage />);
    expect(await screen.findByRole('button', { name: 'Log in with a passkey' })).toBeInTheDocument();
    expect(screen.queryByText('Last used')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Log in with a passkey' }));
    await waitFor(() => expect(signedIn).toHaveBeenCalledWith(USER));
    expect(browser.start).toHaveBeenCalledWith({ optionsJSON: { challenge: 'x' } });
    expect(calls('/auth/passkey/login/verify')[0]![1]).toEqual({ body: { id: 'abcdefghijkl', response: { id: 'cred' } } });
    expect(localStorage.getItem('shopme.lastSignIn')).toBe('passkey');
    first.unmount();
    wrap(<LoginPage />);
    expect(await screen.findByText('Last used')).toBeInTheDocument();
  });

  it('does not complain when the person closes the browser prompt, and hides itself where passkeys cannot work', async () => {
    const user = userEvent.setup();
    routes['/auth/passkey/login/options'] = () => ({ id: 'abcdefghijkl', options: { challenge: 'x' } });
    browser.start.mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));
    const first = wrap(<LoginPage />);
    await user.click(await screen.findByRole('button', { name: 'Log in with a passkey' }));
    await waitFor(() => expect(browser.start).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    first.unmount();
    browser.supported = false;
    wrap(<LoginPage />);
    await screen.findByLabelText('Email');
    expect(screen.queryByRole('button', { name: 'Log in with a passkey' })).toBeNull();
  });
});

describe('e-mail code step', () => {
  it('moves between the six boxes, accepts a pasted code and goes back with backspace', async () => {
    const user = userEvent.setup();
    function Harness() { const [v, setV] = useState(''); return <><DigitBoxes value={v} onChange={setV} label={(n) => `Digit ${n}`} /><output data-testid="v">{v}</output></>; }
    render(<Harness />);
    await user.click(screen.getByLabelText('Digit 1'));
    await user.keyboard('12');
    expect(screen.getByLabelText('Digit 3')).toHaveFocus();
    expect(screen.getByTestId('v')).toHaveTextContent('12');
    await user.keyboard('{Backspace}');
    expect(screen.getByLabelText('Digit 2')).toHaveFocus();
    expect(screen.getByTestId('v')).toHaveTextContent(/^1$/);
    await user.click(screen.getByLabelText('Digit 1'));
    await user.paste('482 913');
    expect(screen.getByTestId('v')).toHaveTextContent('482913');
    expect(screen.getByLabelText('Digit 6')).toHaveFocus();
    expect(screen.getByLabelText('Digit 4')).toHaveValue('9');
  });

  it('follows the password on a new device: verify with the code, resend after the cooldown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    routes['/auth/login'] = () => ({ emailCodeRequired: true, challenge: 'c'.repeat(20), email: 'ada@example.com' });
    routes['/auth/login/email-code'] = (b) => { if ((b as { code: string }).code !== '482913') throw new ApiError('Invalid code', 401); return USER; };
    routes['/auth/login/email-code/resend'] = () => ({ ok: true });
    wrap(<LoginPage />);
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue with email' }));
    await user.type(screen.getByLabelText('Password'), 'a password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'Verify your email to continue' })).toBeInTheDocument();
    expect(screen.getByText('As a security measure, enter the 6-digit code sent to ada@example.com')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    expect(screen.getByText('Resend code in 30 s')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use a passkey instead' })).toBeInTheDocument();
    // Wrong code, then the right one.
    await user.click(screen.getByLabelText('Digit 1'));
    await user.paste('000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('This code is not right.')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Digit 1'));
    await user.paste('482913');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(signedIn).toHaveBeenCalledWith(USER));
    expect(calls('/auth/login/email-code').at(-1)![1]).toEqual({ body: { challenge: 'c'.repeat(20), code: '482913', trust: true } });
  });

  it('lets a new code be requested once the cooldown is over', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routes['/auth/login/email-code/resend'] = () => ({ ok: true });
    wrap(<EmailCodeStep challenge={'c'.repeat(20)} email="ada@example.com" canPasskey={false} onPasskey={() => {}} onBack={() => {}} onDone={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Resend code' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use a passkey instead' })).toBeNull();
    for (let i = 0; i < 31; i++) await act(async () => { vi.advanceTimersByTime(1000); });
    const resend = await screen.findByRole('button', { name: 'Resend code' });
    fireEvent.click(resend);
    await waitFor(() => expect(calls('/auth/login/email-code/resend')).toHaveLength(1));
    expect(await screen.findByText('A new code is on its way.')).toBeInTheDocument();
    expect(screen.getByText(/Resend code in/)).toBeInTheDocument();
  });

  it('is shown in French with the French words', async () => {
    localStorage.setItem('shopme.lang', 'fr');
    wrap(<EmailCodeStep challenge={'c'.repeat(20)} email="ada@example.com" canPasskey onPasskey={() => {}} onBack={() => {}} onDone={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Vérifiez votre e-mail pour continuer' })).toBeInTheDocument();
    expect(screen.getByText('Par mesure de sécurité, saisissez le code à 6 chiffres envoyé à ada@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vérifier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Utiliser plutôt une clé d'accès" })).toBeInTheDocument();
  });
});
