"""Regenerate the committed, synthetic examples: pip install reportlab python-docx python-pptx openpyxl."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from docx import Document
from pptx import Presentation
from pptx.util import Inches, Pt
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
import csv

root = Path(__file__).resolve().parent
title = 'Orbit / Launch review'
paragraphs = [
  'A clear next step makes a good idea useful.',
  'The launch checklist connects design, engineering, and review.',
  'Every annotation keeps its original evidence and your comment together.',
  'Select text to ask a question. Select a region to explain a visual detail.',
]
c = canvas.Canvas(str(root / 'launch-review.pdf'), pagesize=(620, 790))
c.setTitle(title)
c.setFillColor(HexColor('#31563e')); c.setFont('Helvetica', 12); c.drawString(54, 727, 'ORBIT / WORKING NOTES')
c.setFont('Helvetica', 30); c.drawString(54, 669, 'Launch review')
c.setFont('Helvetica', 12); c.setFillColor(HexColor('#566355'))
for i,p in enumerate(paragraphs): c.drawString(54, 619-i*35,p)
c.setFillColor(HexColor('#edf3e7')); c.roundRect(54,290,512,135,12,fill=1,stroke=0)
c.setFillColor(HexColor('#31563e'));c.setFont('Helvetica',19);c.drawString(77,386,'One shared goal. Three small steps.')
for i,s in enumerate(['Define the story','Review the first draft','Polish the final details']): c.setFont('Helvetica',12);c.drawString(77,356-i*22,f'{i+1}. {s}')
c.setFont('Helvetica',10);c.drawString(54,72,'Synthetic demonstration document / annotation-kit 0.1.0')
c.save()
doc=Document();doc.add_heading('Launch review',0)
for p in paragraphs: doc.add_paragraph(p)
doc.add_heading('Review checklist',1)
for s in ['Define the story','Review the first draft','Polish the final details']:doc.add_paragraph(s,style='List Bullet')
doc.save(root/'launch-review.docx')
prs=Presentation();slide=prs.slides.add_slide(prs.slide_layouts[5]);slide.shapes.title.text='Launch review'
box=slide.shapes.add_textbox(Inches(.6), Inches(1.5), Inches(8.5), Inches(4));tf=box.text_frame
for i,text in enumerate(paragraphs):
  p=tf.paragraphs[0] if i==0 else tf.add_paragraph();p.text=text;p.font.size=Pt(22)
prs.save(root/'launch-review.pptx')
rows=[['Milestone','Owner','Planned','Actual','Status'],['Define the story','Design',5,4,'Complete'],['Review the draft','Engineering',8,9,'In review'],['Polish the details','Product',3,2,'In progress'],['Total','',16,15,'']]
wb=Workbook();ws=wb.active;ws.title='Launch plan'
for row in rows:ws.append(row)
ws['C5']='=SUM(C2:C4)';ws['D5']='=SUM(D2:D4)'
for cell in ws[1]:cell.font=Font(color='FFFFFF',bold=True);cell.fill=PatternFill('solid',fgColor='31563E')
for col in ['A','B','C','D','E']:ws.column_dimensions[col].width=24
wb.save(root/'launch-plan.xlsx')
with (root/'launch-plan.csv').open('w',encoding='utf8',newline='') as f:csv.writer(f).writerows(rows)
(root/'notes.md').write_text('# Launch review\n\n'+ '\n\n'.join(paragraphs)+'\n\n| Milestone | Status |\n| --- | --- |\n| Define the story | Complete |\n| Review the draft | In review |\n',encoding='utf8',newline='\n')
(root/'example.ts').write_text('export function nextStep(items: readonly string[]) {\n  return items.find(item => item.length > 0) ?? "Review the draft"\n}\n',encoding='utf8',newline='\n')
print('Generated synthetic PDF, DOCX, PPTX, XLSX, CSV, Markdown and code fixtures')
