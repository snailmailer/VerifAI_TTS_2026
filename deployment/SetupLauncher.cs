using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Windows.Forms;
using System.Text;

internal static class SetupLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            byte[] payload;
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            using (MemoryStream memory = new MemoryStream())
            {
                if (stream == null) throw new InvalidDataException("Installer payload missing.");
                stream.CopyTo(memory);
                payload = memory.ToArray();
            }
            using (MemoryStream memory = new MemoryStream(payload))
            using (ZipArchive archive = new ZipArchive(memory, ZipArchiveMode.Read))
            {
                if (archive.GetEntry("deployment/setup-wizard.ps1") == null &&
                    archive.GetEntry(@"deployment\setup-wizard.ps1") == null)
                    throw new InvalidDataException("Guided setup entrypoint missing.");
                if (args.Length == 1 && args[0] == "--verify-only") return 0;
                if (MessageBox.Show("Set up VerifAI for this Windows account?\n\n" +
                    "After OK, setup will:\n" +
                    "- Extract application files under %LOCALAPPDATA%\\VerifAI\\Packages.\n" +
                    "- Copy collector, native host and dashboard files to %LOCALAPPDATA%\\VerifAI\\App.\n" +
                    "- Stage/update unpacked browser extensions under %LOCALAPPDATA%\\VerifAI\\Extensions.\n" +
                    "- Restrict VerifAI directory access to your account and SYSTEM.\n" +
                    "- Detect Chrome, Edge, Brave and Firefox in standard installation locations.\n" +
                    "- Read browser extension metadata to reuse installed current VerifAI copies where found.\n" +
                    "- Open browser installation pages and show the approval steps you must complete.\n" +
                    "- Copy extension paths to your clipboard and ask for VerifAI Chromium extension IDs.\n" +
                    "- Register supplied VerifAI IDs and the fixed Firefox native-host ID under HKCU.\n" +
                    "- Create or update a VerifAI sign-in startup shortcut.\n" +
                    "- Start a background collector on 127.0.0.1:43821, or reuse a matching installed collector.\n" +
                    "- If an older installed collector is running under your account, stop only that verified process and upgrade it.\n" +
                    "- Open an authenticated dashboard session in your default browser.\n" +
                    "- Write setup logs under %LOCALAPPDATA%\\VerifAI\\Logs.\n\n" +
                    "Existing app/registration/startup files may be updated; event data is retained.\n" +
                    "Node.js 22+ must already be installed. Unverified conflicting processes are never stopped.\n" +
                    "Browser approval cannot be automated: Chrome/Edge/Brave require Load unpacked. " +
                    "Firefox requires Load Temporary Add-on and must be reloaded after browser restart.\n" +
                    "Automatic persistent updates/reinstallation need published/signed packages; they are not included.\n" +
                    "Safari is unavailable on Windows. No browser policy or execution policy is changed.\n\n" +
                    "This executable is unsigned. OK applies the listed changes; Cancel makes no changes. " +
                    "Installation is not transactional; failures can leave partial files/configuration.",
                    "VerifAI Setup", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK)
                    return 0;
                // Keep unpacked extensions at a permanent versioned path, not a temporary folder.
                string hash;
                using (SHA256 sha = SHA256.Create())
                    hash = BitConverter.ToString(sha.ComputeHash(payload)).Replace("-", "");
                string destination = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "VerifAI", "Packages", hash);
                Directory.CreateDirectory(destination);
                string prefix = Path.GetFullPath(destination) + Path.DirectorySeparatorChar;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string target = Path.GetFullPath(Path.Combine(destination, entry.FullName.Replace('/', '\\')));
                    if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("Unsafe installer archive path.");
                    if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\"))
                    { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    if (File.Exists(target))
                    {
                        using (Stream source = entry.Open())
                        using (FileStream existing = File.OpenRead(target))
                        using (SHA256 sha = SHA256.Create())
                        {
                            string expected = BitConverter.ToString(sha.ComputeHash(source));
                            string actual = BitConverter.ToString(sha.ComputeHash(existing));
                            if (expected != actual)
                                throw new InvalidDataException("Existing package file differs from this installer: " +
                                    target + ". It was not overwritten.");
                        }
                        continue;
                    }
                    using (Stream source = entry.Open())
                    using (FileStream output = new FileStream(target, FileMode.CreateNew))
                        source.CopyTo(output);
                }
                string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                    @"WindowsPowerShell\v1.0\powershell.exe");
                ProcessStartInfo info = new ProcessStartInfo(powershell,
                    "-NoProfile -STA -File \"" + Path.Combine(destination, @"deployment\setup-wizard.ps1") + "\"");
                info.UseShellExecute = false;
                info.WorkingDirectory = destination;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                info.CreateNoWindow = true;
                string logDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "VerifAI", "Logs");
                Directory.CreateDirectory(logDirectory);
                string logPath = Path.Combine(logDirectory, "setup-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".log");
                StringBuilder outputLog = new StringBuilder();
                using (Process process = Process.Start(info))
                {
                    process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs line)
                    { if (line.Data != null) lock (outputLog) outputLog.AppendLine(line.Data); };
                    process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs line)
                    { if (line.Data != null) lock (outputLog) outputLog.AppendLine(line.Data); };
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    process.WaitForExit();
                    File.WriteAllText(logPath, outputLog.ToString());
                    if (process.ExitCode != 0)
                        throw new InvalidOperationException("Local setup failed. No complete-install claim was made.\n\n" +
                            outputLog.ToString().Substring(0, Math.Min(outputLog.Length, 1800)) +
                            "\n\nFull diagnostic log: " + logPath);
                }
                // The wizard presents one completion summary, including skipped browser steps.
            }
            return 0;
        }
        catch (Exception error)
        {
            if (!(args.Length == 1 && args[0] == "--verify-only"))
                MessageBox.Show(error.Message, "VerifAI setup failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
