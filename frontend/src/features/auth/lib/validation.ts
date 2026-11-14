"use client";

import { useRef, useState, type FocusEvent } from "react";

/*
 * Client-side checks for the auth forms. They mirror the rules the API enforces
 * (backend/src/modules/auth/dto/*.schema.ts) so a person hears about a problem
 * before the request, in plain words. The API still decides.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(value: string): string | undefined {
  const email = value.trim();
  if (!email) return "Enter your email address.";
  if (!EMAIL.test(email)) return "Enter an email address like you@studio.com.";
  return undefined;
}

export function nameError(value: string): string | undefined {
  const name = value.trim();
  if (!name) return "Enter your name.";
  if (name.length < 2) return "Use at least 2 characters.";
  if (name.length > 50) return "Use 50 characters or fewer.";
  return undefined;
}

/** The sign-in password only has to be present; the API checks it. */
export function currentPasswordError(value: string): string | undefined {
  return value ? undefined : "Enter your password.";
}

/** A new password: 8+ characters with an uppercase letter and a digit. */
export function newPasswordError(value: string): string | undefined {
  if (!value) return "Choose a password.";
  if (value.length < 8) return "Use at least 8 characters.";
  if (!/[A-Z]/.test(value) || !/\d/.test(value)) return "Add an uppercase letter and a digit.";
  return undefined;
}

type Errors<K extends string> = Partial<Record<K, string | undefined>>;

/**
 * Field errors for a form with `noValidate`. An error shows once its field has
 * been left with something in it, or after the first submit. A blocked submit
 * moves focus to the first invalid field, in `order`.
 */
export function useFieldErrors<K extends string>(errors: Errors<K>, order: readonly K[]) {
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<K, boolean>>>({});
  const refs = useRef<Partial<Record<K, HTMLInputElement | null>>>({});

  /** The error to display for a field, if any. */
  function shown(key: K): string | undefined {
    return attempted || touched[key] ? errors[key] : undefined;
  }

  /** Props for the field's input: its ref and the blur rule. */
  function bind(key: K) {
    return {
      ref: (element: HTMLInputElement | null) => {
        refs.current[key] = element;
      },
      onBlur: (event: FocusEvent<HTMLInputElement>) => {
        if (event.target.value) setTouched((current) => ({ ...current, [key]: true }));
      },
    };
  }

  /** Call on submit. Returns true when the form may go on; otherwise focuses the first invalid field. */
  function check(): boolean {
    setAttempted(true);
    const first = order.find((key) => errors[key]);
    if (!first) return true;
    refs.current[first]?.focus();
    return false;
  }

  return { shown, bind, check };
}
