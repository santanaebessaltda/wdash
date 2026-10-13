import { useState } from "react";
import { Button, Card, CardHeader, CardTitle, Checkbox, FormField, Input, PageHeader, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";

function passwordScore(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

const goalStrength = [
  { label: "Very weak", color: "var(--bad)" },
  { label: "Weak", color: "var(--bad)" },
  { label: "Medium", color: "var(--warn)" },
  { label: "Good", color: "var(--ok)" },
  { label: "Strong", color: "var(--ok)" },
];

export function FormValidationPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const toast = useToast();

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const score = passwordScore(password);
  const confirmValid = confirm.length > 0 && confirm === password;

  const firstNameError = submitted && !firstName.trim() ? "First name is required" : undefined;
  const lastNameError = submitted && !lastName.trim() ? "Last name is required" : undefined;
  const emailError = email.length > 0 && !emailValid ? "Please enter a valid email address" : submitted && !email ? "Email is required" : undefined;
  const confirmError = confirm.length > 0 && !confirmValid ? "Passwords do not match" : undefined;

  function fieldClass(hasError: boolean, isValid: boolean) {
    if (hasError) return "!border-2 !border-bad bg-bad-soft";
    if (isValid) return "!border-2 !border-ok bg-ok-soft";
    return "";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const ok = firstName.trim() && lastName.trim() && emailValid && score >= 3 && confirmValid && agreed;
    toast.show(ok ? "Account created successfully" : "Please fix the highlighted fields", ok ? "success" : "danger");
  }

  return (
    <div>
      <PageHeader title="Form Validation" subtitle="Real-time field validation with error messages" />
      <div className="max-w-2xl">
        <Card padding="lg">
          <CardHeader>
            <CardTitle>Registration form</CardTitle>
          </CardHeader>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <FormField label="First name" required error={firstNameError} hint={firstName.trim() ? "Looks good!" : undefined}>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Enter first name"
                  className={fieldClass(Boolean(firstNameError), firstName.trim().length > 0)}
                />
              </FormField>
              <FormField label="Last name" required error={lastNameError}>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Enter last name"
                  className={fieldClass(Boolean(lastNameError), lastName.trim().length > 0)}
                />
              </FormField>
            </div>
            <FormField label="Email" required error={emailError} hint={emailValid ? "Looks good!" : undefined}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={fieldClass(Boolean(emailError), emailValid)}
              />
            </FormField>
            <div>
              <FormField label="Password" required>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password"
                  className={password.length > 0 && score < 3 ? "!border-warn bg-warn-soft" : password.length > 0 ? "!border-2 !border-ok bg-ok-soft" : ""}
                />
              </FormField>
              <div className="mt-2 flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="h-1 flex-1 rounded-full"
                    style={{ background: i < score ? goalStrength[score].color : "var(--bg-inset)" }}
                  />
                ))}
              </div>
              {password.length > 0 && (
                <p className={cn("mt-1.5 text-[11.5px] font-medium", score < 3 ? "text-warn" : "text-ok")}>
                  Password strength: {goalStrength[score].label}
                  {score < 3 && ". Add numbers and symbols."}
                </p>
              )}
            </div>
            <FormField label="Confirm password" required error={confirmError} hint={confirmValid ? "Passwords match" : undefined}>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter password"
                className={fieldClass(Boolean(confirmError), confirmValid)}
              />
            </FormField>
            <Checkbox
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              label={
                <span className="text-t1">
                  I agree to the <span className="font-semibold text-acc">Terms of Service</span> and{" "}
                  <span className="font-semibold text-acc">Privacy Policy</span>
                </span>
              }
            />
            <Button type="submit" fullWidth size="lg">
              Create account
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
