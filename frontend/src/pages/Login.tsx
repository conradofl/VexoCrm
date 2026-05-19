// VexoCrm/frontend/src/pages/Login.tsx
import { getCurrentIdTokenResult, resetPassword } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { AuthLayout } from "@/components/AuthLayout";
import { FormField } from "@/components/FormField";
import { ErrorMessage } from "@/components/ErrorMessage";
import { LogoBlock } from "@/components/LogoBlock";
import { LoadingScreen } from "@/components/LoadingScreen";
import { loginSchema } from "@/lib/validationSchemas";
import { useRateLimit } from "@/hooks/useRateLimit";
import { toast } from "@/components/ui/sonner";
import { ZodError } from "zod";

const loginInputClass =
  "border-white/10 bg-white/[0.06] text-white placeholder:text-white/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] [-webkit-text-fill-color:theme(colors.white)] focus-visible:border-primary/45 focus-visible:bg-white/[0.08] autofill:[-webkit-text-fill-color:theme(colors.white)] autofill:[box-shadow:inset_0_0_0px_1000px_rgba(15,20,38,0.98)] dark:border-white/10 dark:bg-white/[0.06]";

export default function Login() {
  const location = useLocation();
  const { isAuthenticated, mustChangePassword, loading, login, defaultRoute } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const rateLimit = useRateLimit({
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    cooldownMs: 60 * 1000, // 1 minute cooldown
  });
  const requestedPath =
    typeof location.state === "object" &&
    location.state !== null &&
    "from" in location.state &&
    typeof location.state.from === "object" &&
    location.state.from !== null &&
    "pathname" in location.state.from
      ? String(location.state.from.pathname || "")
      : "";
  const redirectTo = mustChangePassword ? "/set-password" : requestedPath || defaultRoute;

  if (loading) return <LoadingScreen />;

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check rate limit
    if (rateLimit.isLimited) {
      setError(rateLimit.cooldownMessage);
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      // Validate input
      const validData = loginSchema.parse({
        email: email.trim(),
        password,
      });

      await login(validData.email, validData.password);
      await getCurrentIdTokenResult(true);
      rateLimit.recordAttempt(true);
    } catch (err: unknown) {
      rateLimit.recordAttempt(false);

      if (err instanceof ZodError) {
        setError(err.errors[0]?.message || "Dados inválidos.");
        return;
      }

      const errorMessages: Record<string, string> = {
        "auth/user-not-found": "Usuario nao encontrado.",
        "auth/wrong-password": "Senha incorreta.",
        "auth/invalid-email": "E-mail invalido.",
        "auth/user-disabled": "Usuario desativado.",
        "auth/too-many-requests": "Muitas tentativas. Tente novamente mais tarde.",
        "auth/invalid-credential": "Credenciais invalidas.",
      };
      const firebaseCode =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code?: string }).code || "")
          : "";
      setError(errorMessages[firebaseCode] || "E-mail ou senha invalidos.");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async () => {
    const emailValidation = loginSchema.pick({ email: true }).safeParse({
      email: email.trim(),
    });

    if (!emailValidation.success) {
      setError(
        emailValidation.error.errors[0]?.message ||
          "Informe um e-mail valido para recuperar a senha."
      );
      return;
    }

    setError("");
    setResettingPassword(true);

    try {
      await resetPassword(emailValidation.data.email);
      toast.success("Link de recuperacao enviado para o e-mail informado.");
    } catch (err: unknown) {
      const firebaseCode =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code?: string }).code || "")
          : "";

      const errorMessages: Record<string, string> = {
        "auth/invalid-email": "Informe um e-mail valido para recuperar a senha.",
        "auth/user-not-found": "Nao encontramos um usuario com esse e-mail.",
        "auth/too-many-requests":
          "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
      };

      setError(
        errorMessages[firebaseCode] ||
          "Nao foi possivel enviar o link de recuperacao agora."
      );
    } finally {
      setResettingPassword(false);
    }
  };

  return (
    <AuthLayout onSubmit={handleSubmit} maxWidth="sm" formAlign="center">
      <LogoBlock icon="V" />

      <div className="w-full space-y-3">
        <div className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <p className="text-sm font-medium text-white">Login</p>
          <p className="mt-1 text-xs leading-5 text-slate-300/85">
            Entre com seu e-mail e senha. Os acessos liberados para cada usuario sao definidos internamente pela gestao do CRM.
          </p>
        </div>
      </div>

      <div className="w-full space-y-4">
        <FormField label="E-mail" id="email">
          <Input
            id="email"
            type="email"
            placeholder="seuemail@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={loginInputClass}
            required
          />
        </FormField>
        <FormField label="Senha" id="password">
          <Input
            id="password"
            type="password"
            placeholder="Digite sua senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={loginInputClass}
            required
          />
        </FormField>
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-xs text-muted-foreground">
            Receba um link para redefinir sua senha no e-mail informado.
          </span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={handlePasswordReset}
            disabled={resettingPassword || submitting}
          >
            {resettingPassword ? "Enviando..." : "Recuperar senha"}
          </Button>
        </div>
      </div>

      <ErrorMessage message={error} className="text-center" />

      {!rateLimit.isLimited && rateLimit.attemptsLeft > 0 && rateLimit.attemptsLeft < 3 && (
        <div className="text-center text-xs text-amber-200/80 bg-amber-500/10 rounded p-2 border border-amber-500/20">
          Aviso: {rateLimit.attemptsLeft} tentativa(s) restante(s)
        </div>
      )}

      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={submitting || rateLimit.isLimited}
      >
        {submitting ? "Entrando..." : "Entrar"}
      </Button>

    </AuthLayout>
  );
}
