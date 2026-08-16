import { execFile } from 'child_process';

/**
 * 通过 PowerShell + WinForms 弹出 Windows 原生资源管理器对话框。
 * 仅适用于本机运行管理后台的场景（浏览器拿不到完整路径，由本地服务端代为选择）。
 * 用户取消或未选择时返回 cancelled。
 */

const PS_FILE_PICKER = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Add-Type -AssemblyName System.Windows.Forms;
$d = New-Object System.Windows.Forms.OpenFileDialog;
$d.Filter = 'Markdown (*.md)|*.md|All Files (*.*)|*.*';
$d.Multiselect = $true;
$d.Title = '选择外部 MD 文档（可多选）';
$d.InitialDirectory = [Environment]::GetFolderPath('Desktop');
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileNames -join [char]10 }`;

const PS_FOLDER_PICKER = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Add-Type -AssemblyName System.Windows.Forms;
$d = New-Object System.Windows.Forms.FolderBrowserDialog;
$d.Description = '选择包含 MD 文档的文件夹（将递归扫描其中的 .md）';
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath }`;

function runPowershell(script: string): Promise<{ cancelled: boolean; paths: string[] }> {
  return new Promise((resolve, reject) => {
    // EncodedCommand（UTF-16LE Base64）避免引号/换行/中文的转义问题
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf8', windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.trim() || err.message));
          return;
        }
        const paths = stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        resolve({ cancelled: paths.length === 0, paths });
      }
    );
  });
}

export async function pickExternalFiles(): Promise<{ cancelled: boolean; paths: string[] }> {
  return runPowershell(PS_FILE_PICKER);
}

export async function pickExternalFolder(): Promise<{ cancelled: boolean; paths: string[] }> {
  return runPowershell(PS_FOLDER_PICKER);
}
