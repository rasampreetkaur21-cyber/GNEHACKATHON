import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from ocr_fields import model_candidates,serial_candidate,invoice_fields
class ExtractionTests(unittest.TestCase):
 def test_six_models_and_manufacturer_codes(self):
  for text,expected in [('SM-A266B/DS','samsung-galaxy-a26-5g'),('SM-A366E','samsung-galaxy-a36-5g'),('Galaxy A56 5G','samsung-galaxy-a56-5g'),('Rockerz 450','boat-rockerz-450'),('R550','boat-rockerz-550'),('Rockerz 650','boat-rockerz-650')]:self.assertIn(expected,model_candidates(text))
 def test_no_substring_model_guess(self):self.assertEqual(model_candidates('A260 and A360'),[])
 def test_competing_models_remain_multiple(self):self.assertEqual(len(model_candidates('Galaxy A26 and Galaxy A36')),2)
 def test_labeled_invoice_fields(self):
  o=invoice_fields('Seller: Example Store\nInvoice No: INV-001\nInvoice Date: 2026-01-15\nSerial No: ABCD-1234')
  self.assertEqual(o['seller_name'],'Example Store');self.assertEqual(o['invoice_number'],'INV-001');self.assertEqual(o['invoice_date'],'2026-01-15');self.assertEqual(o['serial_number'],'ABCD-1234')
 def test_no_invented_seller_or_dates(self):
  o=invoice_fields('A receipt image with no readable labels.');self.assertTrue(all(v=='UNKNOWN' for v in o.values()))
 def test_ambiguous_date_not_guessed(self):self.assertEqual(invoice_fields('Date: 01/02/2026')['invoice_date'],'UNKNOWN')
 def test_conflicting_dates_not_selected_arbitrarily(self):self.assertEqual(invoice_fields('Invoice Date: 2026-01-15\nInvoice Date: 2026-01-16')['invoice_date'],'UNKNOWN')
 def test_serial_needs_label(self):self.assertIsNone(serial_candidate('random ABCD1234'))
if __name__=='__main__':unittest.main()
