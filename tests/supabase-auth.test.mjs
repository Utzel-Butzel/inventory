import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { customFetch } from 'next-auth';
import { createSupabaseAuthProvider } from '../lib/supabase-auth-provider.ts';
import { getAuthProviderConfiguration, validateAuthProviderEnvironment } from '../lib/auth-provider-config.ts';

const require = createRequire(import.meta.url);
const corePath = require.resolve('@auth/core', { paths: [require.resolve('next-auth')] });
const { Auth } = await import(pathToFileURL(corePath));
const environment = {
  AUTH_SUPABASE_URL: 'https://supabase.example.test',
  AUTH_SUPABASE_ANON_KEY: 'public-anon-key',
  AUTH_SUPABASE_CLIENT_ID: 'inventory-client',
  AUTH_SUPABASE_CLIENT_SECRET: 'private-client-secret',
  AUTH_SUPABASE_PROVIDER_NAME: 'Konglomerat',
};
const configuration = getAuthProviderConfiguration(environment).supabase;
const profile = { sub: '11111111-2222-4333-8444-555555555555', email: 'Member@Example.test', email_verified: true, name: 'Member' };

test('Supabase requires complete configuration and an origin; retains password and OIDC support', () => {
  assert.deepEqual(validateAuthProviderEnvironment(environment).errors, []);
  assert.deepEqual(getAuthProviderConfiguration(environment).externalProviders, [{ id: 'supabase', name: 'Konglomerat' }]);
  assert.equal(getAuthProviderConfiguration(environment).passwordEnabled, true);
  assert.deepEqual(validateAuthProviderEnvironment({ ...environment, AUTH_PASSWORD_ENABLED: 'false' }).errors, []);
  for (const key of ['AUTH_SUPABASE_URL','AUTH_SUPABASE_ANON_KEY','AUTH_SUPABASE_CLIENT_ID','AUTH_SUPABASE_CLIENT_SECRET']) {
    assert.ok(validateAuthProviderEnvironment({ ...environment, [key]: '' }).errors.length);
  }
  for (const url of ['http://remote.example.test','https://user:pass@example.test','https://example.test/path','https://example.test?key=value','https://example.test#fragment','invalid']) {
    assert.ok(validateAuthProviderEnvironment({ ...environment, AUTH_SUPABASE_URL: url }).errors.length, url);
  }
  assert.ok(validateAuthProviderEnvironment({ ...environment, AUTH_OIDC_ISSUER: 'https://other.example.test', AUTH_OIDC_CLIENT_ID: 'id', AUTH_OIDC_CLIENT_SECRET: 'secret', AUTH_OIDC_PROVIDER_ID: 'supabase' }).errors.length);
});

test('Supabase profile requires a provider-confirmed identity and never imports roles', () => {
  const provider = createSupabaseAuthProvider(configuration);
  assert.deepEqual(provider.profile({ ...profile, role: 'admin' }), { id: profile.sub, email: 'member@example.test', name: 'Member' });
  for (const patch of [{email_verified:false},{email_verified:'true'},{sub:'invalid'},{email:''},{email:null}]) {
    assert.throws(() => provider.profile({ ...profile, ...patch }));
  }
});

test('gateway requests are limited to token/userinfo and refuse redirects or HTTP errors', async () => {
  const provider = createSupabaseAuthProvider(configuration);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(init.headers.get('apikey'), configuration.apiKey);
      assert.equal(init.headers.get('authorization'), 'Bearer access-token');
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      return Response.json({}, {status:503});
    };
    await assert.rejects(provider[customFetch]('https://evil.example.test/token'), /Unexpected/);
    await assert.rejects(provider[customFetch]('https://supabase.example.test/auth/v1/oauth/userinfo', {headers:{authorization:'Bearer access-token'}}), /request failed/);
  } finally { globalThis.fetch = original; }
});

async function flow({badState=false, verified=true, deny=false}={}) {
  const original = globalThis.fetch;
  const jar = new Map();
  const calls = [];
  let challenge;
  const config = {
    secret: 'a-test-secret-with-at-least-32-characters', trustHost:true, basePath:'/api/auth',
    providers:[createSupabaseAuthProvider(configuration)],
    session:{strategy:'jwt'}, pages:{error:'/login',signIn:'/login'}, logger:{error(){},warn(){},debug(){}},
    callbacks:{signIn:()=>!deny},
  };
  async function request(path, init={}) {
    const response = await Auth(new Request('https://inventory.example.test'+path, {...init,headers:{cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...init.headers}}), config);
    for (const cookie of response.headers.getSetCookie()) {
      const pair=cookie.split(';')[0], i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));
    }
    return response;
  }
  try {
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      assert.equal(new Headers(init.headers).get('apikey'), 'public-anon-key');
      if (String(url).endsWith('/token')) {
        const body=new URLSearchParams(init.body);
        assert.equal(body.get('redirect_uri'),'https://inventory.example.test/api/auth/callback/supabase');
        assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),challenge);
        assert.equal(new Headers(init.headers).get('authorization'),'Basic '+Buffer.from('inventory-client:private-client-secret').toString('base64'));
        return Response.json({access_token:'provider-access-secret',token_type:'bearer',expires_in:3600,refresh_token:'provider-refresh-secret'});
      }
      assert.ok(String(url).endsWith('/userinfo'));
      assert.equal(new Headers(init.headers).get('authorization'),'Bearer provider-access-secret');
      return Response.json({...profile,email_verified:verified});
    };
    const {csrfToken}=await(await request('/api/auth/csrf')).json();
    const start=await request('/api/auth/signin/supabase',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrfToken,callbackUrl:'https://inventory.example.test/konglomerat/inventory'})});
    const location=new URL(start.headers.get('location'));
    assert.equal(location.origin,'https://supabase.example.test');
    assert.equal(location.searchParams.get('scope'),'email profile');
    assert.equal(location.searchParams.get('apikey'),'public-anon-key');
    assert.equal(location.searchParams.get('code_challenge_method'),'S256');
    assert.ok(location.searchParams.get('state'));
    assert.ok(!location.toString().includes('private-client-secret'));
    challenge=location.searchParams.get('code_challenge');
    const callback=await request('/api/auth/callback/supabase?'+new URLSearchParams({code:'one-use-code',state:badState?'wrong':location.searchParams.get('state')}));
    const session=await(await request('/api/auth/session')).json();
    return {callback,session,calls};
  } finally {globalThis.fetch=original;}
}

test('real Auth.js code/PKCE exchange creates a session without exposing provider tokens', async () => {
  const {callback,session,calls}=await flow();
  assert.equal(callback.headers.get('location'),'https://inventory.example.test/konglomerat/inventory');
  assert.equal(session.user.email,'member@example.test');
  assert.equal(calls.length,2);
  assert.ok(!JSON.stringify(session).includes('secret'));
});
test('state tampering is rejected before contacting Supabase', async () => {
  const {callback,session,calls}=await flow({badState:true});
  assert.match(callback.headers.get('location'),/error=/);
  assert.equal(calls.length,0);assert.ok(!session?.user);
});
test('unverified identity and denied local membership cannot obtain a session', async () => {
  for (const options of [{verified:false},{deny:true}]) {
    const {callback,session}=await flow(options);
    assert.match(callback.headers.get('location'),/error=/);assert.ok(!session?.user);
  }
});
