"use client";

import { User, LogOut } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface UserData {
  avatar?: string | null;
  email: string;
  name: string;
}

export interface UserAccountAvatarProps {
  className?: string;
  onProfileSave?: (user: UserData) => void;
  onLogout?: () => void;
  user: UserData;
}

export default function UserAccountAvatar({
  user,
  onProfileSave,
  onLogout,
  className = "",
}: UserAccountAvatarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [userData, setUserData] = useState<UserData>(user);
  const shouldReduceMotion = useReducedMotion();

  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 256 });

  const handleSectionClick = (section: string) => {
    setActiveSection(activeSection === section ? null : section);
  };

  const handleToggle = () => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 8, // offset
        left: rect.right - 256,
        width: 256,
      });
    }
    setIsOpen(!isOpen);
  };

  // Update position on scroll/resize when open
  useEffect(() => {
    if (!(isOpen && buttonRef.current)) {
      return;
    }

    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setPosition({
          top: rect.bottom + 8,
          left: rect.right - 256,
          width: 256,
        });
      }
    };

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        isOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        portalRef.current &&
        !portalRef.current.contains(target)
      ) {
        setIsOpen(false);
        setActiveSection(null);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isOpen && event.key === "Escape") {
        setIsOpen(false);
        setActiveSection(null);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleProfileSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const updatedUser = {
      ...userData,
      name: formData.get("name") as string,
      email: formData.get("email") as string,
    };
    setUserData(updatedUser);
    if (onProfileSave) {
      onProfileSave(updatedUser);
    }
    setActiveSection(null);
  };

  const renderEditProfile = () => (
    <form className="flex flex-col gap-3 p-4 bg-background font-mono" onSubmit={handleProfileSave}>
      <div className="flex flex-col gap-1.5">
        <label
          className="font-medium text-muted-foreground text-[10px] uppercase tracking-wider"
          htmlFor="name"
        >
          Name
        </label>
        <input
          className="rounded-none border border-zinc-200 dark:border-zinc-800 bg-background px-3 py-2 text-foreground text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-zinc-500"
          defaultValue={userData.name}
          id="name"
          name="name"
          placeholder="Enter your name"
          type="text"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          className="font-medium text-muted-foreground text-[10px] uppercase tracking-wider"
          htmlFor="email"
        >
          Email
        </label>
        <input
          className="rounded-none border border-zinc-200 dark:border-zinc-800 bg-background px-3 py-2 text-foreground text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-zinc-500"
          defaultValue={userData.email}
          id="email"
          name="email"
          placeholder="Enter your email"
          type="email"
        />
      </div>

      <button
        className="mt-2 cursor-pointer bg-zinc-950 dark:bg-white text-white dark:text-black hover:bg-zinc-900 dark:hover:bg-zinc-150 border border-zinc-950 dark:border-white px-4 py-2 font-bold text-xs uppercase tracking-wider transition-all active:scale-[0.98]"
        type="submit"
      >
        Save Changes
      </button>
    </form>
  );

  const dropdownContent = (
    <AnimatePresence>
      {isOpen && (
        <div ref={portalRef}>
          <motion.div
            animate={
              shouldReduceMotion
                ? { opacity: 1 }
                : { opacity: 1, y: 0, scaleY: 1 }
            }
            className="fixed z-50 origin-top rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background shadow-xl w-64 overflow-hidden font-mono"
            exit={
              shouldReduceMotion
                ? { opacity: 0, transition: { duration: 0 } }
                : {
                    opacity: 0,
                    y: -10,
                    scaleY: 0.8,
                    transition: { duration: 0.15 },
                  }
            }
            initial={
              shouldReduceMotion
                ? { opacity: 1 }
                : { opacity: 0, y: -10, scaleY: 0.8 }
            }
            style={{
              top: `${position.top}px`,
              left: `${position.left}px`,
              width: `${position.width}px`,
              pointerEvents: "auto",
            }}
            transition={
              shouldReduceMotion
                ? { duration: 0 }
                : { type: "spring" as const, bounce: 0.1, duration: 0.25 }
            }
          >
            <div className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800 p-1.5 bg-background text-foreground">
              {/* User Email Info Header */}
              <div className="px-3 py-2 text-left font-mono">
                <p className="text-[11px] font-black text-foreground truncate">{userData.name}</p>
                <p className="text-[9px] text-zinc-500 truncate mt-0.5">{userData.email}</p>
              </div>

              {/* Edit Profile Option */}
              <button
                className={`flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2.5 font-bold text-xs uppercase tracking-wider transition-colors ${
                  activeSection === "profile"
                    ? "bg-zinc-950 text-white dark:bg-white dark:text-black font-black"
                    : "text-foreground hover:bg-muted"
                }`}
                onClick={() => {
                  handleSectionClick("profile");
                }}
                type="button"
              >
                <User className="shrink-0" size={14} />
                Edit Profile
              </button>

              <AnimatePresence initial={false}>
                {activeSection === "profile" && (
                  <motion.div
                    animate={
                      shouldReduceMotion
                        ? { opacity: 1, height: "auto" }
                        : {
                            opacity: 1,
                            height: "auto",
                            filter: "blur(0px)",
                          }
                    }
                    exit={
                      shouldReduceMotion
                        ? { opacity: 0, height: 0, transition: { duration: 0 } }
                        : { opacity: 0, height: 0, filter: "blur(10px)" }
                    }
                    initial={
                      shouldReduceMotion
                        ? { opacity: 0, height: 0 }
                        : { opacity: 0, height: 0, filter: "blur(10px)" }
                    }
                    transition={
                      shouldReduceMotion
                        ? { duration: 0 }
                        : { type: "spring" as const, duration: 0.25, bounce: 0 }
                    }
                  >
                    {renderEditProfile()}
                  </motion.div>
                )}
              </AnimatePresence>



              {/* Sign Out Option */}
              {onLogout && (
                <button
                  type="button"
                  onClick={() => {
                    onLogout();
                    setIsOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 font-bold text-xs text-destructive hover:bg-destructive/10 transition-colors uppercase border-t border-dashed border-zinc-200 dark:border-zinc-800"
                >
                  <LogOut className="shrink-0" size={14} />
                  Sign Out
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  const hasAvatar = !!userData.avatar;
  const initial = userData.name ? userData.name.trim().charAt(0).toUpperCase() : "?";

  return (
    <>
      <div className={`relative inline-block ${className}`} ref={dropdownRef}>
        <button
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label="User profile dropdown"
          className="flex cursor-pointer items-center justify-center rounded-full border border-black dark:border-zinc-800 bg-background overflow-hidden h-8 w-8 hover:scale-105 active:scale-95 transition-all duration-150 shadow-sm font-mono"
          onClick={handleToggle}
          ref={buttonRef}
          type="button"
        >
          {hasAvatar ? (
            <img
              alt="User Avatar"
              className="rounded-full object-cover h-8 w-8"
              src={userData.avatar!}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-white font-mono text-xs font-black uppercase tracking-wider select-none dark:bg-zinc-850">
              {initial}
            </div>
          )}
        </button>
      </div>
      {typeof window === "undefined"
        ? null
        : createPortal(dropdownContent, document.body)}
    </>
  );
}
