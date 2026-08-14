// AI Gateway — entrypoint. This file only handles the Deno HTTP boundary
// (CORS preflight, verifying the caller's identity) and then hands the
// request to the Task Router, which is where the actual architecture below
// lives:
//
//   Task Router      (taskRouter.ts)          — routes ?action=... to a handler
//   Model Registry    (modelRegistry.ts)       — provider catalog + model listings
//   Provider Router    (providerRouter.ts)     — reads keys/settings, builds fallback chain
//   Cost Controller     (costController.ts)    — usage logging + cost estimation
//   Fallback Engine       (fallbackEngine/)     — tries providers/models in order
//     └─ Providers            (fallbackEngine/providers/) — openrouter, groq, cerebras,
//                                nvidia, mistral, zai, huggingface, direct
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { corsHeaders, errorResponse } from './http.ts';
import { routeTask } from './taskRouter.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify the caller's identity directly against the auth server, rather than
    // relying on an unawaited setSession() call with an empty refresh token. That
    // pattern raced with every query below: it left get_ai_provider_key's internal
    // auth.uid() check running under the service-role key (no caller identity),
    // which fails closed sometimes and, when it doesn't, is fragile to depend on
    // as the only authorization check for a service-role client.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return errorResponse('Unauthorized: no Authorization header sent', 401);

    // Background workers use the service-role key, never a browser JWT. Each
    // internal call is accepted only when its signed-by-service header names a
    // real job in the submitted workspace; the recorded requester then becomes
    // the effective caller and the normal workspace-membership check still runs.
    const campaignJobId = req.headers.get('X-Content-Generation-Job');
    const audienceJobId = req.headers.get('X-Audience-Inference-Job');
    const backgroundJobId = campaignJobId ?? audienceJobId;
    let callerId: string;
    if (backgroundJobId && authHeader === `Bearer ${supabaseServiceKey}`) {
      const body = await req.clone().json().catch(() => ({})) as { workspace_id?: string; background_job_id?: string };
      if (body.background_job_id !== backgroundJobId || !body.workspace_id) return errorResponse('Unauthorized background AI request', 401);

      if (campaignJobId) {
        const { data: job, error: jobError } = await supabase
          .from('content_generation_jobs')
          .select('user_id, workspace_id')
          .eq('id', campaignJobId)
          .eq('workspace_id', body.workspace_id)
          .maybeSingle();
        if (jobError || !job) return errorResponse('Unauthorized background campaign request', 401);
        callerId = job.user_id;
      } else {
        const { data: job, error: jobError } = await supabase
          .from('audience_inference_jobs')
          .select('requested_by, workspace_id')
          .eq('id', audienceJobId!)
          .eq('workspace_id', body.workspace_id)
          .eq('status', 'running')
          .maybeSingle();
        if (jobError || !job) return errorResponse('Unauthorized background audience request', 401);
        callerId = job.requested_by;
      }
    } else {
      const { data: authData, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
      if (authError || !authData.user) {
        console.error('ai-gateway auth check failed:', authError?.message, authError?.status, authError?.name);
        return errorResponse(`Unauthorized: ${authError?.message ?? 'token did not resolve to a user'}`, 401);
      }
      callerId = authData.user.id;
    }

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'chat';

    return await routeTask(action, req, supabase, callerId);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});
