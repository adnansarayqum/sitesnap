Attribute VB_Name = "CompileAndSend"
' =====================================================================
'  CompileAndSend - one button in place of the macro waterfall.
'
'  TEMPLATE: the macro names and sheet names below are taken from a
'  description of the workbook, not from the workbook itself. Set the
'  CONFIG block to the real names before running, and try it on a COPY
'  first.
'
'  Each step is run through RunStep, which reports exactly which step
'  failed instead of leaving the workbook half-built, and always
'  restores ScreenUpdating and alerts on the way out.
' =====================================================================
Option Explicit

' ------------------------- CONFIG ------------------------------------
' Your existing macros, in the order you currently click them.
Private Const MACRO_1 As String = "PopulateText"
Private Const MACRO_2 As String = "FindingsAndRecommendation"
Private Const MACRO_3 As String = "ScottSchedule"      ' rename if yours differs
Private Const MACRO_4 As String = "Items"
Private Const MACRO_PAGES As String = "GeneratePageNumbers"

' Sheets to hide before export (comma separated, no spaces needed).
Private Const BACKEND_SHEETS As String = "Data,Working,Lookups,Conversion"

' Where the finished report is saved. Leave blank to use the folder the
' workbook is already in.
Private Const OUTPUT_FOLDER As String = ""

' Client email. Leave CLIENT_EMAIL blank to leave the To: field empty.
Private Const CLIENT_EMAIL As String = ""
Private Const EMAIL_SUBJECT As String = "Inspection report - "
' ---------------------------------------------------------------------


Public Sub CompileAndEmailReport()
    Dim failedStep As String
    Dim pdfPath As String
    Dim baseName As String

    On Error GoTo Fail

    Application.ScreenUpdating = False
    Application.DisplayAlerts = False
    Application.EnableEvents = False
    Application.Calculation = xlCalculationManual

    ' 1-4: the existing compile chain, in order
    If Not RunStep(MACRO_1, failedStep) Then GoTo Fail
    If Not RunStep(MACRO_2, failedStep) Then GoTo Fail
    If Not RunStep(MACRO_3, failedStep) Then GoTo Fail
    If Not RunStep(MACRO_4, failedStep) Then GoTo Fail

    ' formulas need to settle before page numbers and the PDF
    Application.Calculation = xlCalculationAutomatic
    Application.Calculate

    ' 5: hide the working sheets
    failedStep = "Hiding backend sheets"
    HideBackendSheets

    ' 6: page numbering / contents
    If Not RunStep(MACRO_PAGES, failedStep) Then GoTo Fail

    ' 7: save PDF + workbook
    failedStep = "Saving the PDF"
    baseName = BuildBaseName()
    pdfPath = TargetFolder() & baseName & ".pdf"
    ThisWorkbook.ExportAsFixedFormat Type:=xlTypePDF, _
        Filename:=pdfPath, Quality:=xlQualityStandard, _
        IncludeDocProperties:=True, IgnorePrintAreas:=False, OpenAfterPublish:=False

    failedStep = "Saving the workbook"
    ThisWorkbook.Save

    ' 8: draft the email (drafted, never sent - you read it first)
    failedStep = "Creating the Outlook draft"
    CreateDraft pdfPath, baseName

    Cleanup
    MsgBox "Report compiled." & vbCrLf & vbCrLf & _
           "PDF: " & pdfPath & vbCrLf & _
           "An Outlook draft is waiting in your Drafts folder.", _
           vbInformation, "Done"
    Exit Sub

Fail:
    Cleanup
    MsgBox "Stopped at: " & failedStep & vbCrLf & vbCrLf & _
           IIf(Err.Number <> 0, "Error " & Err.Number & ": " & Err.Description, "") & vbCrLf & vbCrLf & _
           "Nothing was emailed. Fix the step above and run again.", _
           vbExclamation, "Compile failed"
End Sub


' Runs one of the existing macros by name, so a renamed or missing macro
' is reported clearly rather than halting with a bare VBA error.
Private Function RunStep(ByVal macroName As String, ByRef failedStep As String) As Boolean
    failedStep = "Running " & macroName
    On Error GoTo StepFailed
    Application.Run macroName
    RunStep = True
    Exit Function
StepFailed:
    RunStep = False
End Function


Private Sub HideBackendSheets()
    Dim names As Variant, i As Long, ws As Worksheet
    names = Split(BACKEND_SHEETS, ",")
    For i = LBound(names) To UBound(names)
        On Error Resume Next
        Set ws = ThisWorkbook.Worksheets(Trim$(names(i)))
        If Not ws Is Nothing Then ws.Visible = xlSheetHidden
        Set ws = Nothing
        On Error GoTo 0
    Next i
End Sub


Private Function TargetFolder() As String
    Dim f As String
    f = OUTPUT_FOLDER
    If Len(Trim$(f)) = 0 Then f = ThisWorkbook.Path
    If Right$(f, 1) <> Application.PathSeparator Then f = f & Application.PathSeparator
    TargetFolder = f
End Function


' Report name from the workbook name, stripped of anything Windows
' rejects in a filename.
Private Function BuildBaseName() As String
    Dim n As String, bad As Variant, i As Long
    n = ThisWorkbook.Name
    If InStrRev(n, ".") > 0 Then n = Left$(n, InStrRev(n, ".") - 1)
    bad = Array("\", "/", ":", "*", "?", """", "<", ">", "|")
    For i = LBound(bad) To UBound(bad)
        n = Replace(n, bad(i), "-")
    Next i
    BuildBaseName = Trim$(n)
End Function


' Late-bound so the workbook needs no Outlook reference set.
Private Sub CreateDraft(ByVal pdfPath As String, ByVal baseName As String)
    Dim olApp As Object, mail As Object

    On Error Resume Next
    Set olApp = GetObject(, "Outlook.Application")
    If olApp Is Nothing Then Set olApp = CreateObject("Outlook.Application")
    On Error GoTo 0
    If olApp Is Nothing Then Exit Sub   ' no Outlook: PDF is still saved

    Set mail = olApp.CreateItem(0)
    With mail
        .To = CLIENT_EMAIL
        .Subject = EMAIL_SUBJECT & baseName
        .Body = "Dear Sir or Madam," & vbCrLf & vbCrLf & _
                "Please find attached my inspection report for the above property." & vbCrLf & vbCrLf & _
                "Should you require any clarification, please do not hesitate to contact me." & vbCrLf & vbCrLf & _
                "Kind regards"
        .Attachments.Add pdfPath
        .Save                            ' saved to Drafts - never sent
    End With

    Set mail = Nothing
    Set olApp = Nothing
End Sub


Private Sub Cleanup()
    Application.Calculation = xlCalculationAutomatic
    Application.EnableEvents = True
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
End Sub
