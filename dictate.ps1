Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
try {
    $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    $recognizer.SetInputToDefaultAudioDevice()
    $recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(6)
    $phrase = $recognizer.Recognize([TimeSpan]::FromSeconds(10))
    if ($phrase) { [Console]::Write($phrase.Text) }
} finally { $recognizer.Dispose() }
