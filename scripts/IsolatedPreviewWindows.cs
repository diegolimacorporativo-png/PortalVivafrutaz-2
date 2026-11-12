using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace PortalVivafrutaz {
  public interface IContainedProcessApi {
    ProcessHandles CreateSuspended(IntPtr job, string executable, string commandLine, string workingDirectory, IDictionary<string, string> environment);
    uint ResumeThread(IntPtr thread);
    void TerminateProcess(IntPtr process, uint exitCode);
    bool WaitForExit(IntPtr process, uint milliseconds);
    uint GetExitCode(IntPtr process);
    void CloseHandle(IntPtr handle);
  }

  public sealed class ProcessHandles {
    public IntPtr Process;
    public IntPtr Thread;
    public int ProcessId;
  }

  public sealed class ContainedProcess : IDisposable {
    private readonly IContainedProcessApi api;
    private readonly ProcessHandles handles;
    private bool disposed;
    public int Id { get { return handles.ProcessId; } }
    public uint ExitCode { get { EnsureOpen(); return api.GetExitCode(handles.Process); } }

    internal ContainedProcess(IContainedProcessApi processApi, ProcessHandles processHandles) {
      api = processApi;
      handles = processHandles;
    }

    public bool WaitForExit(int milliseconds) {
      EnsureOpen();
      return api.WaitForExit(handles.Process, checked((uint)milliseconds));
    }

    public void Kill(uint exitCode = 1) {
      EnsureOpen();
      api.TerminateProcess(handles.Process, exitCode);
      api.WaitForExit(handles.Process, 10000);
    }

    private void EnsureOpen() {
      if (disposed) throw new ObjectDisposedException(nameof(ContainedProcess));
    }

    public void Dispose() {
      if (disposed) return;
      disposed = true;
      var closeErrors = new List<Exception>();
      try { api.CloseHandle(handles.Thread); } catch (Exception error) { closeErrors.Add(error); }
      try { api.CloseHandle(handles.Process); } catch (Exception error) { closeErrors.Add(error); }
      if (closeErrors.Count > 0)
        throw new AggregateException("Um ou mais handles do processo contido não puderam ser fechados.", closeErrors);
    }
  }

  public static class ContainedProcessLauncher {
    public static ContainedProcess Start(
      IContainedProcessApi api,
      IntPtr job,
      string executable,
      string commandLine,
      string workingDirectory,
      IDictionary<string, string> environment
    ) {
      ProcessHandles process = api.CreateSuspended(job, executable, commandLine, workingDirectory, environment);
      if (process == null || process.Process == IntPtr.Zero || process.Thread == IntPtr.Zero)
        throw new InvalidOperationException("CreateProcess não retornou handles válidos.");

      try {
        uint previousSuspendCount = api.ResumeThread(process.Thread);
        if (previousSuspendCount != 1)
          throw new InvalidOperationException("ResumeThread falhou ou encontrou contagem de suspensão inesperada.");
      } catch {
        TerminateAndClose(api, process);
        throw;
      }

      return new ContainedProcess(api, process);
    }

    private static void TerminateAndClose(IContainedProcessApi api, ProcessHandles process) {
      Exception terminationError = null;
      try {
        api.TerminateProcess(process.Process, 1);
        if (!api.WaitForExit(process.Process, 10000))
          terminationError = new TimeoutException("O processo suspenso não encerrou após a falha de ResumeThread.");
      } catch (Exception error) { terminationError = error; }
      try { api.CloseHandle(process.Thread); } catch (Exception error) { if (terminationError == null) terminationError = error; }
      try { api.CloseHandle(process.Process); } catch (Exception error) { if (terminationError == null) terminationError = error; }
      if (terminationError != null)
        throw new AggregateException("Falha ao limpar processo contido após erro de inicialização; o Job Object permanece responsável por encerrá-lo.", terminationError);
    }
  }

  public sealed class NativeContainedProcessApi : IContainedProcessApi {
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const long PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x0002000D;
    private const long PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
    private const uint WAIT_OBJECT_0 = 0;
    private const uint WAIT_TIMEOUT = 258;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo {
      public uint cb;
      public string lpReserved;
      public string lpDesktop;
      public string lpTitle;
      public uint dwX;
      public uint dwY;
      public uint dwXSize;
      public uint dwYSize;
      public uint dwXCountChars;
      public uint dwYCountChars;
      public uint dwFillAttribute;
      public uint dwFlags;
      public short wShowWindow;
      public short cbReserved2;
      public IntPtr lpReserved2;
      public IntPtr hStdInput;
      public IntPtr hStdOutput;
      public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfoEx {
      public StartupInfo StartupInfo;
      public IntPtr AttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeProcessInformation {
      public IntPtr hProcess;
      public IntPtr hThread;
      public uint dwProcessId;
      public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes {
      public int Length;
      public IntPtr SecurityDescriptor;
      [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(
      string applicationName,
      StringBuilder commandLine,
      IntPtr processAttributes,
      IntPtr threadAttributes,
      bool inheritHandles,
      uint creationFlags,
      IntPtr environment,
      string currentDirectory,
      ref StartupInfoEx startupInfo,
      out NativeProcessInformation processInformation
    );

    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previousValue, IntPtr returnSize);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateFileW(string name, uint access, uint share, ref SecurityAttributes attributes, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", EntryPoint = "CloseHandle", SetLastError = true)] private static extern bool CloseInheritedHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    public ProcessHandles CreateSuspended(IntPtr job, string executable, string commandLine, string workingDirectory, IDictionary<string, string> environment) {
      if (Environment.OSVersion.Platform != PlatformID.Win32NT)
        throw new PlatformNotSupportedException("O runner de preview isolado exige Windows.");
      if (String.IsNullOrWhiteSpace(executable) || !System.IO.Path.IsPathRooted(executable))
        throw new ArgumentException("O executável deve ser um caminho absoluto.", nameof(executable));
      IntPtr environmentPointer = IntPtr.Zero;
      IntPtr attributeList = IntPtr.Zero;
      IntPtr attributeJob = IntPtr.Zero;
      IntPtr handleList = IntPtr.Zero;
      IntPtr nulHandle = IntPtr.Zero;
      bool attributeListInitialized = false;
      NativeProcessInformation processInformation;
      var startupInfo = new StartupInfoEx();
      startupInfo.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(StartupInfoEx));
      try {
        IntPtr attributeListSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref attributeListSize);
        if (attributeListSize == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows não oferece atributos de criação de processo exigidos para contenção atômica.");
        attributeList = Marshal.AllocHGlobal(attributeListSize);
        if (!InitializeProcThreadAttributeList(attributeList, 2, 0, ref attributeListSize))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "InitializeProcThreadAttributeList falhou.");
        attributeListInitialized = true;
        attributeJob = Marshal.AllocHGlobal(IntPtr.Size);
        Marshal.WriteIntPtr(attributeJob, job);
        if (!UpdateProcThreadAttribute(attributeList, 0, new IntPtr(PROC_THREAD_ATTRIBUTE_JOB_LIST), attributeJob, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "A inclusão atômica no Job Object não está disponível; o processo não será criado.");

        var securityAttributes = new SecurityAttributes {
          Length = Marshal.SizeOf(typeof(SecurityAttributes)),
          SecurityDescriptor = IntPtr.Zero,
          InheritHandle = true
        };
        nulHandle = CreateFileW("NUL", 0xC0000000, 0x3, ref securityAttributes, 3, 0, IntPtr.Zero);
        if (nulHandle == new IntPtr(-1)) { nulHandle = IntPtr.Zero; throw new Win32Exception(Marshal.GetLastWin32Error(), "Não foi possível preparar os handles stdio isolados."); }
        handleList = Marshal.AllocHGlobal(IntPtr.Size);
        Marshal.WriteIntPtr(handleList, nulHandle);
        if (!UpdateProcThreadAttribute(attributeList, 0, new IntPtr(PROC_THREAD_ATTRIBUTE_HANDLE_LIST), handleList, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "A lista restrita de handles do processo não pôde ser configurada.");
        startupInfo.AttributeList = attributeList;
        startupInfo.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startupInfo.StartupInfo.hStdInput = nulHandle;
        startupInfo.StartupInfo.hStdOutput = nulHandle;
        startupInfo.StartupInfo.hStdError = nulHandle;
        environmentPointer = Marshal.StringToHGlobalUni(BuildEnvironmentBlock(environment));
        var mutableCommandLine = new StringBuilder(commandLine, commandLine.Length + 2);
        if (!CreateProcessW(
          executable, mutableCommandLine, IntPtr.Zero, IntPtr.Zero, true,
          CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT, environmentPointer,
          workingDirectory, ref startupInfo, out processInformation
        )) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessW suspenso falhou.");
        return new ProcessHandles {
          Process = processInformation.hProcess,
          Thread = processInformation.hThread,
          ProcessId = checked((int)processInformation.dwProcessId)
        };
      } finally {
        if (nulHandle != IntPtr.Zero && !CloseInheritedHandle(nulHandle))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "Não foi possível fechar o handle NUL temporário.");
        if (environmentPointer != IntPtr.Zero) Marshal.FreeHGlobal(environmentPointer);
        if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
        if (attributeList != IntPtr.Zero) {
          if (attributeListInitialized) DeleteProcThreadAttributeList(attributeList);
          Marshal.FreeHGlobal(attributeList);
        }
        if (attributeJob != IntPtr.Zero) Marshal.FreeHGlobal(attributeJob);
      }
    }

    private static string BuildEnvironmentBlock(IDictionary<string, string> environment) {
      var entries = new List<string>();
      foreach (var pair in environment) {
        if (String.IsNullOrEmpty(pair.Key) || pair.Key.IndexOf('=') >= 0 || pair.Value.IndexOf('\0') >= 0)
          throw new ArgumentException("Bloco de ambiente inválido.");
        entries.Add(pair.Key + "=" + pair.Value);
      }
      entries.Sort(StringComparer.OrdinalIgnoreCase);
      return String.Join("\0", entries) + "\0\0";
    }

    public uint ResumeThread(IntPtr thread) {
      uint result = ResumeThreadEntry(thread);
      if (result == UInt32.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error(), "ResumeThread falhou.");
      return result;
    }
    [DllImport("kernel32.dll", EntryPoint = "ResumeThread", SetLastError = true)] private static extern uint ResumeThreadEntry(IntPtr thread);

    public void TerminateProcess(IntPtr process, uint exitCode) {
      if (!TerminateProcessEntry(process, exitCode)) {
        int error = Marshal.GetLastWin32Error();
        if (error != 5) throw new Win32Exception(error, "TerminateProcess falhou.");
      }
    }
    [DllImport("kernel32.dll", EntryPoint = "TerminateProcess", SetLastError = true)] private static extern bool TerminateProcessEntry(IntPtr process, uint exitCode);

    public bool WaitForExit(IntPtr process, uint milliseconds) {
      uint result = WaitForSingleObject(process, milliseconds);
      if (result == WAIT_TIMEOUT) return false;
      if (result != WAIT_OBJECT_0) throw new Win32Exception(Marshal.GetLastWin32Error(), "WaitForSingleObject falhou.");
      return true;
    }

    public uint GetExitCode(IntPtr process) {
      uint code;
      if (!GetExitCodeProcess(process, out code)) throw new Win32Exception(Marshal.GetLastWin32Error(), "GetExitCodeProcess falhou.");
      return code;
    }

    public void CloseHandle(IntPtr handle) {
      if (handle != IntPtr.Zero && !CloseHandleEntry(handle))
        throw new Win32Exception(Marshal.GetLastWin32Error(), "CloseHandle falhou.");
    }
    [DllImport("kernel32.dll", EntryPoint = "CloseHandle", SetLastError = true)] private static extern bool CloseHandleEntry(IntPtr handle);
  }

  public sealed class IsolatedProcessJob : IDisposable {
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private IntPtr handle;

    [StructLayout(LayoutKind.Sequential)] private struct BasicLimitInformation {
      public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
      public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
      public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters {
      public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount;
      public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimitInformation {
      public BasicLimitInformation BasicLimitInformation; public IoCounters IoInfo;
      public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)] private struct BasicAccountingInformation {
      public long TotalUserTime; public long TotalKernelTime; public long ThisPeriodTotalUserTime; public long ThisPeriodTotalKernelTime;
      public uint PageFaultCount; public uint TotalProcesses; public uint ActiveProcesses; public uint TotalTerminatedProcesses;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimitInformation info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out BasicAccountingInformation info, uint length, IntPtr returnLength);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);

    public IsolatedProcessJob() {
      // An unnamed Job Object prevents another same-user process from opening
      // a named object and keeping KILL_ON_JOB_CLOSE from reaching last-handle.
      handle = CreateJobObject(IntPtr.Zero, null);
      if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject falhou.");
      var info = new ExtendedLimitInformation();
      info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      if (!SetInformationJobObject(handle, 9, ref info, (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation)))) {
        int error = Marshal.GetLastWin32Error(); CloseHandle(handle); handle = IntPtr.Zero;
        throw new Win32Exception(error, "Configuração KILL_ON_JOB_CLOSE falhou.");
      }
    }
    public IntPtr Handle { get { if (handle == IntPtr.Zero) throw new ObjectDisposedException(nameof(IsolatedProcessJob)); return handle; } }
    public void Assign(IntPtr processHandle) {
      if (processHandle == IntPtr.Zero) throw new ArgumentException("Handle de processo inválido.", nameof(processHandle));
      if (!AssignProcessToJobObject(Handle, processHandle))
        throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject falhou.");
    }
    public void Terminate(uint exitCode) {
      if (handle == IntPtr.Zero) throw new ObjectDisposedException(nameof(IsolatedProcessJob));
      if (!TerminateJobObject(handle, exitCode)) throw new Win32Exception(Marshal.GetLastWin32Error(), "TerminateJobObject falhou.");
    }
    public uint ActiveProcessCount {
      get {
        if (handle == IntPtr.Zero) throw new ObjectDisposedException(nameof(IsolatedProcessJob));
        BasicAccountingInformation info;
        if (!QueryInformationJobObject(handle, 1, out info, (uint)Marshal.SizeOf(typeof(BasicAccountingInformation)), IntPtr.Zero))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "QueryInformationJobObject falhou.");
        return info.ActiveProcesses;
      }
    }
    public void Dispose() {
      if (handle != IntPtr.Zero) {
        IntPtr closing = handle;
        if (!CloseHandle(closing)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Fechamento do Job Object falhou.");
        handle = IntPtr.Zero;
      }
    }
  }

  public sealed class PinnedPath : IDisposable {
    private const uint FILE_READ_ATTRIBUTES = 0x80;
    private const uint GENERIC_READ = 0x80000000;
    private const uint FILE_SHARE_READ = 0x1;
    private const uint FILE_SHARE_WRITE = 0x2;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private IntPtr handle;
    private readonly bool directory;
    public readonly string FinalPath;
    public readonly uint VolumeSerial;
    public readonly ulong FileIndex;
    public readonly uint Attributes;

    [StructLayout(LayoutKind.Sequential)] private struct ByHandleFileInformation {
      public uint FileAttributes; public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime; public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
      public uint VolumeSerialNumber; public uint FileSizeHigh; public uint FileSizeLow; public uint NumberOfLinks;
      public uint FileIndexHigh; public uint FileIndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandle(IntPtr handle, out ByHandleFileInformation info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandleW(IntPtr handle, StringBuilder path, uint length, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ReadFile(IntPtr file, byte[] buffer, uint bytesToRead, out uint bytesRead, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);

    private PinnedPath(string path, bool isDirectory) {
      directory = isDirectory;
      // Marker handles deny new write/delete opens while its contents are read.
      // Directory handles allow normal PostgreSQL access but are identity-checked
      // again before and after every destructive path operation.
      uint share = isDirectory ? FILE_SHARE_READ | FILE_SHARE_WRITE : FILE_SHARE_READ;
      uint flags = FILE_FLAG_OPEN_REPARSE_POINT | (isDirectory ? FILE_FLAG_BACKUP_SEMANTICS : 0);
      uint access = FILE_READ_ATTRIBUTES | (isDirectory ? 0 : GENERIC_READ);
      handle = CreateFileW(path, access, share, IntPtr.Zero, OPEN_EXISTING, flags, IntPtr.Zero);
      if (handle == new IntPtr(-1)) { handle = IntPtr.Zero; throw new Win32Exception(Marshal.GetLastWin32Error(), "Não foi possível fixar o caminho."); }
      try {
        ByHandleFileInformation info;
        if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Não foi possível ler identidade do caminho aberto.");
        Attributes = info.FileAttributes;
        if ((Attributes & 0x400) != 0) throw new InvalidOperationException("Reparse point não permitido.");
        if (isDirectory != ((Attributes & 0x10) != 0)) throw new InvalidOperationException("O tipo do caminho aberto não corresponde ao esperado.");
        VolumeSerial = info.VolumeSerialNumber;
        FileIndex = ((ulong)info.FileIndexHigh << 32) | info.FileIndexLow;
        var buffer = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
        if (length == 0 || length >= buffer.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error(), "Não foi possível resolver o caminho aberto.");
        FinalPath = NormalizeFinalPath(buffer.ToString());
      } catch { Close(); throw; }
    }
    public static PinnedPath OpenDirectory(string path) { return new PinnedPath(path, true); }
    public static PinnedPath OpenRegularFile(string path) { return new PinnedPath(path, false); }
    public string ReadUtf8Text() {
      if (directory || handle == IntPtr.Zero) throw new InvalidOperationException("A leitura é permitida somente em arquivo regular fixado.");
      using (var content = new MemoryStream()) {
        var buffer = new byte[4096];
        uint bytesRead;
        do {
          if (!ReadFile(handle, buffer, (uint)buffer.Length, out bytesRead, IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Não foi possível ler o marcador pelo handle fixado.");
          if (bytesRead > 0) content.Write(buffer, 0, checked((int)bytesRead));
        } while (bytesRead > 0);
        return Encoding.UTF8.GetString(content.ToArray());
      }
    }
    private static string NormalizeFinalPath(string path) {
      if (path.StartsWith("\\\\?\\UNC\\", StringComparison.OrdinalIgnoreCase)) return "\\\\" + path.Substring(8);
      if (path.StartsWith("\\\\?\\", StringComparison.OrdinalIgnoreCase)) return path.Substring(4);
      return path;
    }
    public void AssertSamePath(string path) {
      using (var current = new PinnedPath(path, directory)) {
        if (current.VolumeSerial != VolumeSerial || current.FileIndex != FileIndex ||
            !String.Equals(current.FinalPath, FinalPath, StringComparison.OrdinalIgnoreCase))
          throw new InvalidOperationException("A identidade do caminho mudou desde a validação.");
      }
    }
    private void Close() {
      if (handle != IntPtr.Zero) {
        IntPtr closing = handle;
        if (!CloseHandle(closing)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Fechamento do handle fixado falhou.");
        handle = IntPtr.Zero;
      }
    }
    public void Dispose() { Close(); }
  }

  public static class PrivateDirectory {
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes {
      public int Length; public IntPtr SecurityDescriptor; public bool InheritHandle;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl, uint revision, out IntPtr descriptor, IntPtr size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateDirectoryW(string path, ref SecurityAttributes attributes);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr LocalFree(IntPtr memory);
    public static void CreateForCurrentUser(string path) {
      string sid = WindowsIdentity.GetCurrent().User.Value;
      string sddl = "D:P(A;OICI;FA;;;" + sid + ")(A;OICI;FA;;;SY)";
      IntPtr descriptor;
      if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, out descriptor, IntPtr.Zero))
        throw new Win32Exception(Marshal.GetLastWin32Error(), "Não foi possível criar o descritor ACL privado.");
      try {
        var attributes = new SecurityAttributes { Length = Marshal.SizeOf(typeof(SecurityAttributes)), SecurityDescriptor = descriptor, InheritHandle = false };
        if (!CreateDirectoryW(path, ref attributes)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Criação da raiz temporária com ACL privada falhou.");
      } finally { LocalFree(descriptor); }
    }
  }
}
