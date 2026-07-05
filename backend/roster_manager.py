import pandas as pd
from datetime import datetime, time, timedelta
from backend.config import settings

class RosterManager:
    def __init__(self, file_path: str = None):
        self.file_path = file_path or settings.ROSTER_FILE_PATH
        self.shift_definitions = {}
        self.load_shift_definitions()
        
    def load_shift_definitions(self):
        try:
            df_defs = pd.read_excel(self.file_path, sheet_name="Shift_Definitions")
            for _, row in df_defs.iterrows():
                acronym = row["Shift Acronym"]
                time_block = row["Time Block"]
                self.shift_definitions[acronym] = time_block
        except Exception as e:
            print(f"Error loading shift definitions: {e}")
            # Fallback defaults
            self.shift_definitions = {
                "AM": "06:00-14:00",
                "EVE": "14:00-22:00",
                "N": "22:00-06:00",
                "OFF": "Day Off"
            }

    def get_shift_for_date(self, associate_name: str, tech_domain: str, dt: datetime) -> str:
        """
        Gets the shift acronym (e.g. AM, EVE, N, OFF) for an associate on a specific date.
        """
        try:
            sheet_name = tech_domain.replace(" ", "_")
            df = pd.read_excel(self.file_path, sheet_name=sheet_name)
            
            # Find the row for the associate
            assoc_row = df[df["Associate Name"] == associate_name]
            if assoc_row.empty:
                return "OFF"
                
            day_str = str(dt.day)
            if day_str in assoc_row.columns:
                return str(assoc_row.iloc[0][day_str])
        except Exception as e:
            print(f"Error reading shift for {associate_name} on {dt.date()}: {e}")
            
        return "OFF"

    def is_on_shift(self, associate_name: str, tech_domain: str, dt: datetime) -> bool:
        """
        Checks if an associate is on duty at the exact datetime.
        Handles night shifts (e.g. 22:00 - 06:00) which cross midnight.
        """
        # 1. Check shift on current day
        current_shift = self.get_shift_for_date(associate_name, tech_domain, dt)
        
        if current_shift != "OFF" and current_shift in self.shift_definitions:
            time_block = self.shift_definitions[current_shift]
            if time_block != "Day Off" and "-" in time_block:
                start_str, end_str = time_block.split("-")
                start_h, start_m = map(int, start_str.split(":"))
                end_h, end_m = map(int, end_str.split(":"))
                
                start_time = time(start_h, start_m)
                end_time = time(end_h, end_m)
                current_time = dt.time()
                
                # Check normal shift (doesn't cross midnight)
                if start_time < end_time:
                    if start_time <= current_time <= end_time:
                        return True
                # Check night shift (crosses midnight) e.g. 22:00 - 06:00
                else:
                    if current_time >= start_time or current_time <= end_time:
                        # If current_time is after start_time, they are on shift today
                        # If current_time is before end_time, they are on shift from yesterday's night shift
                        return True

        # 2. Check if current time is early morning and associate had a night shift starting yesterday
        current_time = dt.time()
        # If it's early morning (e.g. before 12:00 PM), check if they were on night shift yesterday
        if current_time < time(12, 0):
            yesterday_dt = dt - timedelta(days=1)
            yesterday_shift = self.get_shift_for_date(associate_name, tech_domain, yesterday_dt)
            
            if yesterday_shift == "N":  # Night shift
                time_block = self.shift_definitions.get("N", "22:00-06:00")
                if "-" in time_block:
                    _, end_str = time_block.split("-")
                    end_h, end_m = map(int, end_str.split(":"))
                    end_time = time(end_h, end_m)
                    
                    if current_time <= end_time:
                        return True
                        
        return False

    def get_active_associates(self, associates_list: list, dt: datetime) -> list:
        """
        Filters a list of associate dicts (containing name and domain)
        and returns only those who are actively on shift at the given datetime.
        """
        active = []
        for assoc in associates_list:
            if self.is_on_shift(assoc["name"], assoc["domain"], dt):
                active.append(assoc)
        return active
