@rem
@rem Gradle startup script for Windows.
@rem

@if "%DEBUG%"=="" @echo off
setlocal

set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.
set APP_HOME=%DIRNAME%

if defined JAVA_HOME goto findJavaFromJavaHome

set JAVA_EXE=java.exe
%JAVA_EXE% -version >NUL 2>&1
if %ERRORLEVEL% equ 0 goto execute

echo ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH. 1>&2
echo Install Java 17 and set JAVA_HOME before running the Android build. 1>&2
goto fail

:findJavaFromJavaHome
set JAVA_HOME=%JAVA_HOME:"=%
set JAVA_EXE=%JAVA_HOME%\bin\java.exe
if exist "%JAVA_EXE%" goto execute

echo ERROR: JAVA_HOME is set to an invalid directory: %JAVA_HOME% 1>&2
goto fail

:execute
set CLASSPATH=%APP_HOME%gradle\wrapper\gradle-wrapper.jar
"%JAVA_EXE%" -Dorg.gradle.appname=%~n0 -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
set EXIT_CODE=%ERRORLEVEL%
if %EXIT_CODE% equ 0 goto end

:fail
if "%EXIT_CODE%"=="" set EXIT_CODE=1
if not "%GRADLE_EXIT_CONSOLE%"=="" exit %EXIT_CODE%
exit /b %EXIT_CODE%

:end
endlocal