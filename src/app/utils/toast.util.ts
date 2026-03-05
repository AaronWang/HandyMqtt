import Swal from 'sweetalert2';

export class ToastUtil {
  static show(icon: 'success' | 'error' | 'warning' | 'info', title: string, text?: string, timeout: number = 3000): void {
    const Toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: timeout,
      timerProgressBar: true,
      didOpen: (toast) => {
        toast.onmouseenter = Swal.stopTimer;
        toast.onmouseleave = Swal.resumeTimer;
      }
    });

    Toast.fire({
      icon: icon,
      title: title,
      text: text
    });
  }

  static success(title: string, text?: string, timeout: number = 1000): void {
    this.show('success', title, text, timeout);
  }

  static error(title: string, text?: string, timeout: number = 3000): void {
    this.show('error', title, text, timeout);
  }

  static warning(title: string, text?: string, timeout: number = 3000): void {
    this.show('warning', title, text, timeout);
  }

  static info(title: string, text?: string, timeout: number = 1000): void {
    this.show('info', title, text, timeout);
  }

  static async confirm(title: string, text?: string, confirmButtonText: string = 'Confirm', cancelButtonText: string = 'Cancel'): Promise<boolean> {
    const result = await Swal.fire({
      title: title,
      text: text,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#007acc',
      cancelButtonColor: '#d33',
      confirmButtonText: confirmButtonText,
      cancelButtonText: cancelButtonText
    });

    return result.isConfirmed;
  }
}
