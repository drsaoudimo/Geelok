/**
 * Math Validation Utility for Gleeok Factorization
 */

export interface ValidationResult {
  valid: boolean;
  message: string;
}

/**
 * Performs the final modular check (N % p === 0 && p * q === N) and dispatches 
 * a custom success event to display a success notification if the factors are confirmed.
 */
export function verifyAndNotifyFactors(
  N: bigint | string | number,
  p: bigint | string | number,
  q: bigint | string | number
): ValidationResult {
  try {
    const bigintN = BigInt(N);
    const bigintP = BigInt(p);
    const bigintQ = BigInt(q);

    if (bigintP <= 1n || bigintQ <= 1n) {
      return {
        valid: false,
        message: "عوامل غير صالحة: يجب أن تكون العوامل أكبر من 1"
      };
    }

    const modCheck = bigintN % bigintP === 0n;
    const prodCheck = bigintP * bigintQ === bigintN;

    if (modCheck && prodCheck) {
      const message = `🎉 تم التحقق بنجاح! عوامل المعامل N صحيحة ومطابقة تماماً. p = ${bigintP}, q = ${bigintQ}`;
      
      // Dispatch custom DOM event so that UI components can listen and display a gorgeous toast/notification
      if (typeof window !== "undefined") {
        const successEvent = new CustomEvent("gleeok-factor-success", {
          detail: {
            message,
            p: bigintP.toString(),
            q: bigintQ.toString(),
            N: bigintN.toString()
          }
        });
        window.dispatchEvent(successEvent);
      }

      // Directly inject a floating HTML notification into the page for visual confirmation
      if (typeof document !== "undefined") {
        let container = document.getElementById("gleeok-notification-container");
        if (!container) {
          container = document.createElement("div");
          container.id = "gleeok-notification-container";
          container.setAttribute("style", "position: fixed; top: 24px; left: 24px; z-index: 99999; display: flex; flex-direction: column; gap: 12px; max-width: 450px; direction: rtl; pointer-events: none;");
          document.body.appendChild(container);
        }

        const toast = document.createElement("div");
        toast.setAttribute("style", "pointer-events: auto; background-color: #022c22; border: 1px solid #10b981; color: #a7f3d0; padding: 16px 20px; border-radius: 12px; font-family: sans-serif; font-size: 13px; font-weight: 600; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4); display: flex; align-items: start; gap: 12px; transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); opacity: 0; transform: translateX(-40px);");

        toast.innerHTML = `
          <div style="background-color: #064e3b; border-radius: 9999px; padding: 4px; display: flex; align-items: center; justify-content: center; color: #34d399; flex-shrink: 0;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </div>
          <div style="flex-grow: 1; line-height: 1.5;">
            <div style="font-size: 14px; font-weight: 700; color: #ffffff; margin-bottom: 2px;">تأكيد فك العوامل</div>
            <div>${message}</div>
          </div>
          <button style="background: none; border: none; color: #059669; cursor: pointer; padding: 2px; display: flex; align-items: center; justify-content: center;" onclick="this.parentElement.remove()">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        `;

        container.appendChild(toast);
        
        // Trigger visual transitions
        setTimeout(() => {
          toast.style.opacity = "1";
          toast.style.transform = "translateX(0)";
        }, 30);

        // Auto remove after 8 seconds
        setTimeout(() => {
          toast.style.opacity = "0";
          toast.style.transform = "translateX(-40px)";
          setTimeout(() => {
            toast.remove();
          }, 400);
        }, 8000);
      }

      return {
        valid: true,
        message
      };
    } else {
      return {
        valid: false,
        message: "فشل التحقق الرياضي: العوامل لا تطابق المعامل N."
      };
    }
  } catch (error: any) {
    return {
      valid: false,
      message: `خطأ في التنسيق الرقمي أثناء التحقق: ${error?.message || error}`
    };
  }
}
