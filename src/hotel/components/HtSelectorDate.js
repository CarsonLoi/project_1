import React, { useEffect } from "react";
import dayjs from "dayjs";
import { Stack } from '@mui/material';
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";

export default function HtSelectorDate({ selected_Start, selected_End, set_Selected_Start, set_Selected_End }) {
    const [value, setValue] = React.useState(null);
    const [valueEnd, setValueEnd] = React.useState(null);

    useEffect(() => {
        if (selected_Start && selected_End) {
            setValue(dayjs(selected_Start));
            setValueEnd(dayjs(selected_End));
        }
    }, [selected_Start, selected_End]);

    const changeDate = (date) => {
        if (!date) return;
        const date_start = dayjs(date).format('YYYY-MM-DD');
        setValue(dayjs(date));
        set_Selected_Start(date_start);

        if (dayjs(valueEnd).isBefore(dayjs(date))) {
            setValueEnd(dayjs(date));
            set_Selected_End(date_start);
        }
    };

    const changeDateEnd = (dateEnd) => {
        if (!dateEnd) return;
        const date_start = dayjs(value).format('YYYY-MM-DD');
        const date_end = dayjs(dateEnd).format('YYYY-MM-DD');

        if (dayjs(dateEnd).isAfter(dayjs(value)) || dayjs(dateEnd).isSame(dayjs(value))) {
            setValueEnd(dayjs(dateEnd));
            set_Selected_End(date_end);
        } else {
            setValueEnd(dayjs(value));
            set_Selected_End(date_start);
        }
    };

    const datePickerSx = {
        width: '150px',
        "& .MuiOutlinedInput-input": {
            paddingTop: '10px',
            color: "rgba(240,240,240,0.8)",
            fontSize: 17
        },
        "& .MuiSvgIcon-root": {
            fontSize: '21px', color: 'rgba(255,255,255,0.7)'
        },
        "& .MuiInputLabel-root": {
            fontSize: 17,
            color: 'rgba(150,150,150,0.8)',
            '&.Mui-focused': { color: '#7aa2f7' }
        },
        '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(150,150,150,0.4)'
        },
        '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(255,255,255,0.5)'
        }
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDayjs}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', ml: 1 }}>
                <DatePicker
                    label="Start Date"
                    value={value}
                    format="MMM DD, YYYY"
                    onChange={changeDate}
                    sx={datePickerSx}
                    slotProps={{ textField: { size: 'small' } }}
                />
                <DatePicker
                    label="End Date"
                    value={valueEnd}
                    minDate={value}
                    format="MMM DD, YYYY"
                    onChange={changeDateEnd}
                    sx={datePickerSx}
                    slotProps={{ textField: { size: 'small' } }}
                />
            </Stack>
        </LocalizationProvider>
    );
}
